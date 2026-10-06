from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    app_name: str = "AI Smart Notes"
    database_url: str = "sqlite:///./app.db"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    frontend_url: str = (
        "https://ai-smart-transcription-platform.vercel.app"
    )
    upload_dir: str = "storage/uploads"
    output_dir: str = "storage/outputs"
    google_client_secret_file: str = "credentials.json"
    google_redirect_uri: str = (
        "http://127.0.0.1:8000/api/calendar/callback"
    )
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()