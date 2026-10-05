import time
from google import genai

from app.config import settings


def get_client():
    """
    Create a Gemini client using the API key from settings.
    """
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    return genai.Client(api_key=settings.gemini_api_key)


def _generate_with_retry(client, model, contents, max_retries=3):
    """
    Call Gemini with automatic retry for temporary 503/UNAVAILABLE errors.
    """

    last_error = None

    for attempt in range(max_retries):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents
            )

        except Exception as exc:
            last_error = exc
            error_text = str(exc)

            is_temporary = (
                "503" in error_text
                or "UNAVAILABLE" in error_text
                or "temporarily" in error_text.lower()
                or "high demand" in error_text.lower()
            )

            if not is_temporary or attempt == max_retries - 1:
                raise

            wait_seconds = 2 ** attempt
            time.sleep(wait_seconds)

    raise last_error


def transcribe(
    audio_path: str,
    language: str | None = None
):
    """
    Transcribe an audio file using Gemini File API.

    No Whisper/PyTorch model is loaded locally.
    """

    client = get_client()
    audio_file = None

    try:
        # Upload audio to Gemini File API.
        audio_file = client.files.upload(
            file=audio_path
        )

        if language:
            language_instruction = (
                f"The spoken language is expected to be {language}. "
                f"Transcribe it accurately in that language."
            )
        else:
            language_instruction = (
                "Automatically detect the spoken language and "
                "transcribe it accurately."
            )

        prompt = f"""
You are a professional speech-to-text transcription system.

{language_instruction}

Transcribe the COMPLETE audio.

Rules:
1. Return only the transcription.
2. Do not summarize.
3. Do not explain the content.
4. Do not add information that was not spoken.
5. Do not omit important spoken content.
6. Preserve the original meaning.
7. Keep the transcription readable.
8. If multiple people speak, preserve the spoken content in sequence.
9. Do not generate notes.
10. Do not generate headings unless they were actually spoken.

Return only the transcript.
"""

        response = _generate_with_retry(
            client=client,
            model=settings.gemini_model,
            contents=[
                audio_file,
                prompt
            ]
        )

        text = (response.text or "").strip()

        if not text:
            raise RuntimeError(
                "Gemini returned an empty transcription."
            )

        return {
            "language": language or "auto",
            "language_probability": 1.0,
            "segments": [],
            "text": text
        }

    finally:
        # Delete the remote Gemini File immediately.
        if audio_file is not None:
            try:
                client.files.delete(
                    name=audio_file.name
                )
            except Exception:
                pass