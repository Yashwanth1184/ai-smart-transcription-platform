import os
from sqlalchemy import inspect, text
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.database import Base, engine
from app.routes.api import router

# Ensure storage directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)

# Create database tables
Base.metadata.create_all(bind=engine)

# Safe lightweight schema migration for SQLite
try:
    inspector = inspect(engine)
    if "notes" in inspector.get_table_names():
        note_cols = {c["name"] for c in inspector.get_columns("notes")}
        with engine.begin() as conn:
            if "note_language" not in note_cols:
                conn.execute(text("ALTER TABLE notes ADD COLUMN note_language VARCHAR(20) DEFAULT 'en'"))
            if "note_labels_json" not in note_cols:
                conn.execute(text("ALTER TABLE notes ADD COLUMN note_labels_json TEXT DEFAULT '{}'"))
except Exception:
    pass

app = FastAPI(
    title=settings.app_name,
    version="1.0.0"
)

# Explicit allowed origins
ALLOWED_ORIGINS = [
    "https://ai-smart-transcription-platform.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
if settings.frontend_url and settings.frontend_url not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(settings.frontend_url.rstrip("/"))

# CORS Middleware with explicit wildcards as fallback
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Global catch-all handler to guarantee CORS headers on any 500 error
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin", "*")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={
            "Access-Control-Allow-Origin": origin if origin in ALLOWED_ORIGINS else "*",
            "Access-Control-Allow-Credentials": "true",
        },
    )

app.include_router(router)

# Mount static storage
app.mount("/storage", StaticFiles(directory="storage"), name="storage")

@app.get("/")
def root():
    return {"service": settings.app_name, "status": "running"}

@app.get("/health")
def health():
    return {"status": "healthy"}