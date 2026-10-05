from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "AI-Powered Smart Transcription and Content Abstraction Platform"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    upload_dir: str = "storage/uploads"
    output_dir: str = "storage/outputs"
    database_url: str = "sqlite:///./storage/app.db"
    google_client_secret_file: str = "credentials.json"
    google_redirect_uri: str = "http://127.0.0.1:8000/api/calendar/callback"
    frontend_url: str = "http://localhost:5173"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
