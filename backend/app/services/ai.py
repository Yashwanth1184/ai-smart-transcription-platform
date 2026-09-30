import json
from google import genai
from google.genai import types
from app.config import settings

NOTE_SCHEMAS = {
    "summary": ["title", "overview", "main_points", "key_insights", "important_details", "conclusion"],
    "meeting": ["meeting_title", "agenda", "discussion_points", "decisions_made", "action_items", "important_follow_ups", "next_meeting"],
    "lecture": ["subject", "topic", "learning_objectives", "main_concepts", "detailed_explanation", "important_definitions", "examples", "key_points", "quick_revision"],
    "task": ["task_title", "description", "tasks", "required_actions", "deadlines", "next_steps"],
}

SUPPORTED_LANGUAGES = {
    "en": "English", "kn": "Kannada", "hi": "Hindi", "te": "Telugu", "ta": "Tamil",
    "ml": "Malayalam", "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati", "pa": "Punjabi",
    "or": "Odia", "as": "Assamese", "ur": "Urdu", "ne": "Nepali", "fr": "French",
    "de": "German", "es": "Spanish", "it": "Italian", "pt": "Portuguese", "ja": "Japanese",
    "zh": "Chinese"
}

SYSTEM = """You are the content abstraction engine for an academic/professional note-taking platform.
Return valid JSON only. Do not invent facts. Use empty strings/lists when information is absent.
Preserve names, numbers, deadlines and technical terms from the transcript.
"""


def client():
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in backend/.env")
    return genai.Client(api_key=settings.gemini_api_key)


def language_name(code: str) -> str:
    return SUPPORTED_LANGUAGES.get(code, code or "English")


def generate_notes(transcript: str, note_type: str, target_language: str = "en"):
    if note_type not in NOTE_SCHEMAS:
        raise ValueError("note_type must be summary, meeting, lecture or task")
    language = language_name(target_language)
    schema = {k: "string or list" for k in NOTE_SCHEMAS[note_type]}
    prompt = f"""{SYSTEM}
Generate {note_type.upper()} notes using exactly these JSON keys: {json.dumps(schema)}.

TARGET LANGUAGE: {language}
Write EVERY human-readable value in the JSON in {language}, including titles, section content,
bullet points, descriptions, explanations, conclusions, action items and task text.
Do not leave English headings or explanatory sentences when {language} is not English.
Technical names, programming keywords, product names and proper nouns may remain in their original
form when translating them would make them inaccurate. Preserve the original meaning and all useful facts.

TRANSCRIPT:
{transcript}
"""
    result = client().models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
    )
    return json.loads(result.text)



def generate_note_labels(note_type: str, target_language: str = "en"):
    if note_type not in NOTE_SCHEMAS:
        raise ValueError("Invalid note type")
    language = language_name(target_language)
    keys = NOTE_SCHEMAS[note_type]
    prompt = f"""Translate these note section labels into {language}. Return a JSON object using exactly the same keys.
Keys: {json.dumps(keys)}
Translate the label values naturally and concisely. Do not add or remove keys."""
    result = client().models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0),
    )
    return json.loads(result.text)

def translate_notes(note_json: dict, target_language: str):
    language = language_name(target_language)
    prompt = f"""{SYSTEM}
Translate the following complete structured note into {language}.

Rules:
- Return the SAME JSON structure and keys.
- Translate every human-readable value, including titles, descriptions, headings represented as values,
  bullet points, action items, deadlines descriptions, conclusions and task text.
- Do not omit, summarize, expand, or change facts.
- Preserve numbers, dates, names, code, URLs and technical identifiers where appropriate.
- For lists of objects, translate each human-readable field while preserving the object structure.
- The JSON keys themselves must remain unchanged.

NOTE JSON:
{json.dumps(note_json, ensure_ascii=False)}
"""
    result = client().models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1),
    )
    return json.loads(result.text)


def chat_with_note(transcript: str, note_json: dict, question: str):
    prompt = f"{SYSTEM}\nAnswer the user's question using only the supplied transcript and notes. If the answer is not present, say so.\nNOTES: {json.dumps(note_json, ensure_ascii=False)}\nTRANSCRIPT: {transcript}\nQUESTION: {question}"
    result = client().models.generate_content(model=settings.gemini_model, contents=prompt, config=types.GenerateContentConfig(temperature=0.2))
    return result.text


def extract_tasks(transcript: str):
    prompt = f"{SYSTEM}\nExtract actionable tasks from this transcript. Return JSON array. Each item must have title, description, assigned_to, deadline, priority, status. Only include tasks explicitly supported by the transcript.\nTRANSCRIPT:\n{transcript}"
    result = client().models.generate_content(model=settings.gemini_model, contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1))
    return json.loads(result.text)


def analyze_frame(image_path: str, transcript_context: str = "", timestamp: float = 0.0):
    with open(image_path, "rb") as f:
        data = f.read()
    prompt = f"""Analyze this video frame for a smart-notes multimedia extraction system.
Timestamp: {timestamp:.2f} seconds.

Determine whether the frame contains meaningful visual content that should be shown to the user.
Possible types: diagram, code, image, slide, text, table, chart, or other.
Ignore ordinary talking-head frames, empty screens, repeated frames and decorative visuals.
If it contains code, transcribe the visible code as accurately as possible.
If it contains a diagram/chart/table/slide, describe its meaningful content and visible text.
Use the spoken context only to improve interpretation; do not invent visual details.

Return JSON with exactly these fields:
has_visual, type, title, description, extracted_text, code, code_language, importance, spoken_context.
importance must be one of: high, medium, low.

SPOKEN CONTEXT AROUND THIS TIMESTAMP:
{transcript_context or '(not available)'}
"""
    result = client().models.generate_content(
        model=settings.gemini_model,
        contents=[types.Part.from_bytes(data=data, mime_type="image/jpeg"), prompt],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1),
    )
    return json.loads(result.text)
