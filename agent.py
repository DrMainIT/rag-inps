from langchain.chat_models import init_chat_model
from dotenv import load_dotenv
from langchain.tools import tool
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

from langgraph.prebuilt import ToolNode
from langgraph.graph.message import MessagesState
from langgraph.graph import END, StateGraph, START

from langchain_core.messages import SystemMessage

load_dotenv()


# ============================================================
# LLM
# ============================================================

model = init_chat_model(
    "qwen3:0.6b",
    model_provider="ollama",
    temperature=0,
    max_tokens=1000,
    max_retries=5,
)


# ============================================================
# EMBEDDINGS
# ============================================================

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-mpnet-base-v2"
)


# ============================================================
# VECTOR STORE
# ============================================================

vector_store = Chroma(
    collection_name="example_collection",
    embedding_function=embeddings,
    persist_directory="./hg_chroma_db",
)


# ============================================================
# UTILITIES
# ============================================================

def _normalize_source(source: str | None) -> str:
    if not source:
        return "Unknown"

    return str(source).replace("\\", "/")


# ============================================================
# RETRIEVAL TOOL
# ============================================================

@tool(response_format="content_and_artifact")
def retrieve_context(query: str):
    """
    Cerca nei documenti INPS informazioni rilevanti per rispondere
    alla domanda dell'utente.
    """

    # Per il momento NON usare threshold.
    # Prima verifichiamo che il retrieval funzioni correttamente.
    retrieved_docs = vector_store.similarity_search(
        query,
        k=10,
    )

    print("\n====================================")
    print("[RETRIEVAL]")
    print(f"[QUERY] {query}")
    print(f"[DOCUMENTS] {len(retrieved_docs)}")

    for i, doc in enumerate(retrieved_docs, start=1):
        source = _normalize_source(
            doc.metadata.get("source")
        )

        page = doc.metadata.get(
            "page",
            "N/A",
        )

        print(
            f"[DOC {i}] "
            f"{source} - Page {page}"
        )

        print(
            doc.page_content[:300]
            .replace("\n", " ")
        )

    print("====================================\n")

    serialized = "\n\n".join(
        (
            f"Source: "
            f"{_normalize_source(doc.metadata.get('source'))}\n"
            f"Page: {doc.metadata.get('page', 'N/A')}\n"
            f"Content: {doc.page_content}"
        )
        for doc in retrieved_docs
    )

    return serialized, retrieved_docs


# ============================================================
# TOOLS
# ============================================================

tools = [
    retrieve_context,
]

model_with_tools = model.bind_tools(tools)

tool_node = ToolNode(
    tools=tools
)


# ============================================================
# SYSTEM PROMPT
# ============================================================
SYSTEM_PROMPT = """
Sei un assistente specializzato in documentazione INPS.

LINGUA:
- Rispondi sempre in italiano.

USO DELLO STRUMENTO:
- Se la domanda riguarda INPS, bonus, agevolazioni, incentivi, sussidi,
  giovani, famiglie, lavoro, disoccupazione, pensioni, contributi,
  imprese o prestazioni sociali, DEVI usare retrieve_context prima
  di rispondere.
- Per saluti, domande sulla tua identità o conversazione generale,
  rispondi direttamente senza usare strumenti.
- Dopo aver usato retrieve_context, usa i risultati per rispondere.
- Se i risultati sono insufficienti, dichiaralo chiaramente.
- Non effettuare più di una ricerca salvo che la prima query sia
  chiaramente troppo generica.

RICERCA:
- Trasforma domande generiche in query utili per il retrieval.
- Per esempio, se l'utente chiede "sono giovane, ho agevolazioni?",
  cerca concetti come:
  "agevolazioni giovani incentivi bonus under 35 lavoro assunzione"
- Non cercare frasi colloquiali letterali se possono essere riscritte
  in termini più adatti ai documenti normativi.

RISPOSTE:
- Sii conciso e diretto.
- Non inventare informazioni.
- Cita sempre le fonti usate.
"""


# ============================================================
# AGENT NODE
# ============================================================

def call_model(state: MessagesState):

    messages = state["messages"]

    messages_for_model = [
        SystemMessage(
            content=SYSTEM_PROMPT
        ),
        *messages,
    ]

    response = model_with_tools.invoke(
        messages_for_model
    )

    print("\n[AGENT]")
    print(
        "Content:",
        repr(response.content[:300])
        if isinstance(response.content, str)
        else response.content,
    )

    print(
        "Tool calls:",
        response.tool_calls,
    )

    return {
        "messages": [
            response
        ]
    }


# ============================================================
# ROUTER
# ============================================================

def should_continue(
    state: MessagesState,
):

    last_message = state["messages"][-1]

    tool_calls = getattr(
        last_message,
        "tool_calls",
        [],
    )

    print("\n[ROUTER]")

    if tool_calls:
        print(
            "Agent requested tool -> tools"
        )

        return "tools"

    print(
        "No tool requested -> END"
    )

    return END


# ============================================================
# GRAPH
# ============================================================

builder = StateGraph(
    MessagesState
)

builder.add_node(
    "agent",
    call_model,
)

builder.add_node(
    "tools",
    tool_node,
)

builder.add_edge(
    START,
    "agent",
)

builder.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        END: END,
    },
)

builder.add_edge(
    "tools",
    "agent",
)


# IMPORTANT:
# NON aggiungere:
#
# builder.add_edge("agent", END)
#
# perché il conditional edge gestisce già END.


graph = builder.compile()