from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma



embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-mpnet-base-v2"
)

vector_store = Chroma(
    collection_name="example_collection",
    embedding_function=embeddings,
    persist_directory="./hg_chroma_db",
)


query = "agevolazioni giovani incentivi bonus under 35 lavoro assunzione"

results = vector_store.similarity_search_with_relevance_scores(
    query,
    k=20,
)

print(f"Risultati: {len(results)}")
print("Documenti in Chroma:", vector_store._collection.count())
for i, (doc, score) in enumerate(results, start=1):
    print("\n" + "=" * 80)
    print(f"RISULTATO {i}")
    print(f"SCORE: {score}")
    print(f"SOURCE: {doc.metadata.get('source')}")
    print(f"PAGE: {doc.metadata.get('page')}")
    print(doc.page_content[:1000])