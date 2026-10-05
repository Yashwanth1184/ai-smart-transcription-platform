import time
import os

from google import genai

from app.config import settings
from app.services.media import cleanup_temp_audio


# ============================================================
# GEMINI CLIENT
# ============================================================

def get_client():
    """
    Create a Gemini client using the API key from settings.
    """

    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not configured."
        )

    return genai.Client(
        api_key=settings.gemini_api_key
    )


# ============================================================
# GEMINI RETRY
# ============================================================

def _generate_with_retry(
    client,
    model,
    contents,
    max_retries=3,
):
    """
    Call Gemini with automatic retry for temporary
    availability/rate-related errors.
    """

    last_error = None

    for attempt in range(max_retries):

        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
            )

        except Exception as exc:

            last_error = exc
            error_text = str(exc)

            is_temporary = (
                "503" in error_text
                or "UNAVAILABLE" in error_text
                or "temporarily" in error_text.lower()
                or "high demand" in error_text.lower()
                or "429" in error_text
                or "RESOURCE_EXHAUSTED" in error_text
            )

            if (
                not is_temporary
                or attempt == max_retries - 1
            ):
                raise

            wait_seconds = 2 ** attempt

            time.sleep(
                wait_seconds
            )

    raise last_error


# ============================================================
# TRANSCRIPTION
# ============================================================

def transcribe(
    audio_path: str,
    language: str | None = None,
):
    """
    Transcribe audio using the Gemini File API.

    Flow:

        Local audio
             ↓
        Gemini File API
             ↓
        Gemini transcription
             ↓
        Transcript returned
             ↓
        Gemini remote file deleted
             ↓
        Local temporary audio deleted

    No Whisper, PyTorch, TorchAudio, or local
    speech-recognition model is used.
    """

    if not audio_path:
        raise ValueError(
            "Audio path is required."
        )

    if not os.path.exists(audio_path):
        raise FileNotFoundError(
            f"Audio file not found: {audio_path}"
        )

    client = get_client()

    audio_file = None

    try:

        # ========================================================
        # UPLOAD AUDIO TO GEMINI FILE API
        # ========================================================

        audio_file = client.files.upload(
            file=audio_path
        )

        if not audio_file:
            raise RuntimeError(
                "Gemini File API returned no file."
            )

        # ========================================================
        # LANGUAGE INSTRUCTION
        # ========================================================

        if language:

            language_instruction = (
                f"The spoken language is expected to be "
                f"{language}. "
                f"Transcribe the speech accurately in "
                f"that language."
            )

        else:

            language_instruction = (
                "Automatically detect the spoken language "
                "and transcribe it accurately."
            )

        # ========================================================
        # TRANSCRIPTION PROMPT
        # ========================================================

        prompt = f"""
You are a professional speech-to-text transcription system.

{language_instruction}

Transcribe the COMPLETE audio.

Strict requirements:

1. Return only the transcription.
2. Do not summarize.
3. Do not explain the content.
4. Do not add information that was not spoken.
5. Do not omit spoken content.
6. Preserve the original meaning.
7. Keep the transcription readable.
8. Preserve the order of speech.
9. If multiple people speak, transcribe their speech
   in the order it occurs.
10. Do not generate notes.
11. Do not generate a summary.
12. Do not generate tasks.
13. Do not generate headings unless they were actually
    spoken.
14. Do not invent missing words.
15. Do not describe background visuals.
16. Return the complete transcript.

Return ONLY the transcript.
"""

        # ========================================================
        # GENERATE TRANSCRIPTION
        # ========================================================

        response = _generate_with_retry(
            client=client,
            model=settings.gemini_model,
            contents=[
                audio_file,
                prompt,
            ],
        )

        text = (
            response.text
            if response and response.text
            else ""
        )

        text = text.strip()

        if not text:

            raise RuntimeError(
                "Gemini returned an empty transcription."
            )

        # ========================================================
        # RETURN RESULT
        # ========================================================

        return {
            "language": language or "auto",
            "language_probability": 1.0,
            "segments": [],
            "text": text,
        }

    finally:

        # ========================================================
        # DELETE GEMINI REMOTE FILE
        # ========================================================

        if audio_file is not None:

            try:

                client.files.delete(
                    name=audio_file.name
                )

            except Exception:
                # Cleanup failure should not hide a
                # successful transcription.
                pass

        # ========================================================
        # DELETE LOCAL TEMPORARY AUDIO
        # ========================================================

        try:

            cleanup_temp_audio(
                audio_path
            )

        except Exception:
            pass