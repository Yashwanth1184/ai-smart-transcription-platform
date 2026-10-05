import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.database import Base, engine
from app.routes.api import router as api_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Smart Transcription Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)

app.mount("/storage/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
app.mount("/storage/outputs", StaticFiles(directory=settings.output_dir), name="outputs")

app.include_router(api_router)


@app.get("/")
def root():
    return {"message": "AI Smart Transcription Platform Backend Running"}