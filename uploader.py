from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os,re,json
from langchain.chat_models import init_chat_model
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.tools import tool
from langchain.agents import create_agent
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
import pypdf
load_dotenv()  

#model = init_chat_model("google_genai:gemini-2.5-flash")
#embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
#embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-mpnet-base-v2")
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-mpnet-base-v2")
vector_store = Chroma(
    collection_name="example_collection",
    embedding_function=embeddings,
    persist_directory="./hg_chroma_db",
)


def load_pdf_pages(file_path: str) -> list[Document]:
    reader = pypdf.PdfReader(file_path)
    
    filename = os.path.basename(file_path)
    
    docs = []
    for i, page in enumerate(reader.pages):
        try:
            content = page.extract_text() or ""
        except Exception as e:
            print(f"  AVVISO: Errore nel PDF {filename} pagina {i}: {e}")
            content = ""
        
        docs.append(Document(
            page_content=content,
            metadata={"source": file_path, "page": i},
        ))
    return docs



pdf_dirs = os.listdir("data/pdfs")
documents = []
for list_pdfs in pdf_dirs[:10]:
    pdfs = os.listdir(os.path.join("data/pdfs", list_pdfs))
    for pdf in pdfs:
        try:
            pdf_path = os.path.join("data/pdfs", list_pdfs, pdf)
            pdf_documents = load_pdf_pages(pdf_path)
            documents.extend(pdf_documents)
        except Exception as e:
            print(f"Error ERRORRORORORROROORORROS {pdf}: {e}")


text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,  # chunk size (characters)
    chunk_overlap=200,  # chunk overlap (characters)
    add_start_index=True,  # track index in original document
)

all_splits = text_splitter.split_documents(documents)
print(f"Split blog post into {len(all_splits)} sub-documents.")

try:
    document_ids = vector_store.add_documents(documents=all_splits)
except Exception as e:
    print(f"Error adding documents: {e}")
    document_ids = []


"""
from google import genai    
client = genai.Client() # Automatically picks up GOOGLE_API_KEY from your .env
total_tokens = 0

for doc in all_splits:
    response = client.models.count_tokens(
        model="gemini-embedding-001",
        contents=doc.page_content
    )
    total_tokens += response.total_tokens
print(f"Total exact tokens required for embeddings: {total_tokens}")
"""


