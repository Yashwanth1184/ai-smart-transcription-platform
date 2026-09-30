import os
from sqlalchemy import inspect, text
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.db.database import Base, engine
from app.routes.api import router

os.makedirs(settings.upload_dir,exist_ok=True); os.makedirs(settings.output_dir,exist_ok=True)
Base.metadata.create_all(bind=engine)
# Lightweight migration for installations created from an earlier version.
try:
    inspector = inspect(engine)
    note_columns = {c["name"] for c in inspector.get_columns("notes")}
    if "note_language" not in note_columns or "note_labels_json" not in note_columns:
        with engine.begin() as conn:
            if "note_language" not in note_columns:
                conn.execute(text("ALTER TABLE notes ADD COLUMN note_language VARCHAR(20) DEFAULT 'en'"))
            if "note_labels_json" not in note_columns:
                conn.execute(text("ALTER TABLE notes ADD COLUMN note_labels_json TEXT DEFAULT '{}'"))
except Exception:
    pass
app=FastAPI(title=settings.app_name,version="1.0.0")
app.add_middleware(CORSMiddleware,allow_origins=[settings.frontend_url,"http://localhost:5173","http://127.0.0.1:5173"],allow_origin_regex=r"https?://[^/]+(?::\d+)?",allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
app.include_router(router)
app.mount("/storage", StaticFiles(directory="storage"), name="storage")
@app.get("/")
def root(): return {"service":settings.app_name,"status":"running","modules":["transcription","four-note-types","multilingual-notes","ai-chat","tasks","reminders","calendar","automatic-visual-analysis","multimedia","export","collaboration"]}
@app.get("/health")
def health(): return {"status":"healthy"}
