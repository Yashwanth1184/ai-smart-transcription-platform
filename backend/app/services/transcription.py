from functools import lru_cache
from faster_whisper import WhisperModel
from app.config import settings


@lru_cache(maxsize=1)
def get_model():
    return WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        cpu_threads=1,
        num_workers=1
    )


def transcribe(audio_path: str, language: str | None = None):
    model = get_model()

    segments, info = model.transcribe(
        audio_path,
        language=language or None,
        vad_filter=True,
        beam_size=1
    )

    rows = []

    for s in segments:
        rows.append({
            "start": round(s.start, 2),
            "end": round(s.end, 2),
            "text": s.text.strip()
        })

    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "segments": rows,
        "text": " ".join(x["text"] for x in rows)
    }