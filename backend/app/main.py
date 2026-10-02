import os

from sqlalchemy import inspect, text
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.database import Base, engine
from app.routes.api import router


# ---------------------------------------------------------
# Create required directories
# ---------------------------------------------------------
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)


# ---------------------------------------------------------
# Create database tables
# ---------------------------------------------------------
Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------
# Lightweight database migration
# ---------------------------------------------------------
try:
    inspector = inspect(engine)

    note_columns = {
        column["name"]
        for column in inspector.get_columns("notes")
    }

    if (
        "note_language" not in note_columns
        or "note_labels_json" not in note_columns
    ):
        with engine.begin() as conn:

            if "note_language" not in note_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notes "
                        "ADD COLUMN note_language VARCHAR(20) "
                        "DEFAULT 'en'"
                    )
                )

            if "note_labels_json" not in note_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notes "
                        "ADD COLUMN note_labels_json TEXT "
                        "DEFAULT '{}'"
                    )
                )

except Exception:
    # Do not prevent the application from starting
    # if the migration is unnecessary or already applied.
    pass


# ---------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------
app = FastAPI(
    title=settings.app_name,
    version="1.0.0"
)


# ---------------------------------------------------------
# CORS
# ---------------------------------------------------------
ALLOWED_ORIGINS = [
    # Production Vercel frontend
    "https://ai-smart-transcription-platform.vercel.app",

    # Local development
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Also include the configured frontend URL if it is different.
if settings.frontend_url and settings.frontend_url not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(settings.frontend_url)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# API routes
# ---------------------------------------------------------
app.include_router(router)


# ---------------------------------------------------------
# Static storage
# ---------------------------------------------------------
app.mount(
    "/storage",
    StaticFiles(directory="storage"),
    name="storage"
)


# ---------------------------------------------------------
# Root endpoint
# ---------------------------------------------------------
@app.get("/")
def root():
    return {
        "service": settings.app_name,
        "status": "running",
        "modules": [
            "transcription",
            "four-note-types",
            "multilingual-notes",
            "ai-chat",
            "tasks",
            "reminders",
            "calendar",
            "automatic-visual-analysis",
            "multimedia",
            "export",
            "collaboration",
        ],
    }


# ---------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "healthy"
    }