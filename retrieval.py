
from google import genai    
import os   
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import pypdf
from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

client = genai.Client() # Automatically picks up GOOGLE_API_KEY from your .env
total_tokens = 0


def load_pdf_pages(file_path: str) -> list[Document]:
    reader = pypdf.PdfReader(file_path)
    return [
        Document(
            page_content=page.extract_text() or "",
            metadata={"source": file_path, "page": i},
        )
        for i, page in enumerate(reader.pages)
    ]




pdf_dirs = os.listdir("data/pdfs")
documents = []
for pdf in pdf_dirs:
    for file in os.listdir(os.path.join("data/pdfs", pdf)):
        print(f"Processing PDF: {pdf}")
        try:
            pdf_path = os.path.join("data/pdfs", pdf, file)
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


for doc in all_splits:
    response = client.models.count_tokens(
        model="gemini-embedding-001",
        contents=doc.page_content
    )
    total_tokens += response.total_tokens
print(f"Total exact tokens required for embeddings: {total_tokens}")