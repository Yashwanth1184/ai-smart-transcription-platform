from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    app_name: str = "AI Smart Notes"

    # ============================================================
    # DATABASE
    # ============================================================

    database_url: str = "sqlite:///./app.db"

    # ============================================================
    # GEMINI
    # ============================================================

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"

    # ============================================================
    # FRONTEND
    # ============================================================

    frontend_url: str = (
        "https://ai-smart-transcription-platform.vercel.app"
    )

    # ============================================================
    # STORAGE
    # ============================================================

    upload_dir: str = "storage/uploads"
    output_dir: str = "storage/outputs"

    # ============================================================
    # GOOGLE CALENDAR
    # ============================================================

    google_client_secret_file: str = "credentials.json"

    google_redirect_uri: str = (
        "http://127.0.0.1:8000/api/calendar/callback"
    )

    # ============================================================
    # PYDANTIC SETTINGS
    # ============================================================

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()