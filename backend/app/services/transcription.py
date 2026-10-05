import os
import re
from google import genai
from app.config import settings

def parse_time(time_str: str) -> float:
    parts = [float(p) for p in time_str.split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return 0.0

def transcribe(audio_path: str, language: str | None = None):
    client = genai.Client(api_key=settings.gemini_api_key)
    
    # Upload audio file to Gemini File API
    audio_file = client.files.upload(file=audio_path)
    
    prompt = (
        "Transcribe this audio verbatim. "
        "Provide timestamped segments in this exact line format:\n"
        "[00:00 - 00:05] Transcribed text here\n"
        "Do not include markdown codeblocks or extra conversation."
    )
    if language and language != "auto":
        prompt += f" The speech language is {language}."

    model_name = settings.gemini_model or "gemini-2.5-flash"

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=[audio_file, prompt]
        )
    finally:
        # Delete audio file from Gemini File API
        try:
            client.files.delete(name=audio_file.name)
        except Exception:
            pass

    full_text = response.text or ""
    
    # Parse timestamps
    segments = []
    text_chunks = []
    pattern = re.compile(r"\[(\d+:\d+(?::\d+)?)\s*-\s*(\d+:\d+(?::\d+)?)\]\s*(.*)")

    for line in full_text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = pattern.match(line)
        if match:
            start_s = parse_time(match.group(1))
            end_s = parse_time(match.group(2))
            clean_text = match.group(3).strip()
            segments.append({"start": start_s, "end": end_s, "text": clean_text})
            text_chunks.append(clean_text)
        else:
            segments.append({"start": 0.0, "end": 0.0, "text": line})
            text_chunks.append(line)

    return {
        "language": language or "en",
        "language_probability": 1.0,
        "segments": segments,
        "text": " ".join(text_chunks) if text_chunks else full_text
    }