from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from dotenv import load_dotenv
from datasets import load_dataset
import os 
load_dotenv()

embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-mpnet-base-v2")
vector_store = Chroma(
    collection_name="example_collection",
    embedding_function=embeddings,
    persist_directory="./hg_chroma_db",
)


dataset = load_dataset(
    "your-username/your-private-dataset",
    split="train[:1]",
    token=os.environ["HF_TOKEN"],
)

print(dataset)

