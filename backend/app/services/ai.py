import json
import re
from typing import Any, Dict, List, Tuple
from google import genai
from google.genai import types
from app.config import settings

def _get_client() -> genai.Client:
    return genai.Client(api_key=settings.gemini_api_key)

def _get_candidate_models() -> List[str]:
    candidate_models = [
        settings.gemini_model or "gemini-3.8-flash",
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
    ]
    # Remove duplicates while preserving priority order
    return list(dict.fromkeys(candidate_models))

def _generate_with_fallback(contents: Any, config: types.GenerateContentConfig | None = None) -> str:
    client = _get_client()
    models = _get_candidate_models()
    last_error = None

    for model_name in models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )
            if response and response.text:
                return response.text
        except Exception as e:
            last_error = e
            continue

    if last_error:
        raise last_error
    raise RuntimeError("No output generated from Gemini API candidate models.")


# ============================================================================
# Note Generation
# ============================================================================

def generate_notes(
    transcript: str,
    note_type: str = "summary",
    language: str = "en",
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """
    Generates structured notes according to note_type and language.
    Returns (content_dict, labels_dict).
    """
    prompt = f"""
You are an expert note-taking assistant. Analyze the following transcript and generate structured notes.

Note Type: {note_type}
Target Language: {language}

Transcript:
{transcript}

Instructions:
1. Provide the output in strict JSON format.
2. Structure the JSON logically based on the note type:
   - summary: title, overview, main_points (list), key_insights (list), conclusion
   - meeting: meeting_title, agenda (list), discussion_points (list), decisions_made (list), action_items (list), next_meeting
   - lecture: subject, topic, learning_objectives (list), main_concepts (list), detailed_explanation, examples (list), quick_revision (list)
   - task: task_title, description, tasks (list of objects with 'title', 'priority', 'deadline'), next_steps (list)
3. Translate all values to the requested target language: {language}.
4. Return ONLY valid JSON with keys matching the schema. No markdown formatting or extra commentary.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )

    raw_json = _generate_with_fallback(contents=prompt, config=config)

    # Clean code fences if any leaked through
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_json.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        content = json.loads(cleaned)
    except Exception:
        content = {
            "title": f"{note_type.title()} Notes",
            "overview": raw_json,
        }

    # Generate friendly field labels
    labels = {k: k.replace("_", " ").title() for k in content.keys()}
    return content, labels


# ============================================================================
# Note Translation
# ============================================================================

def translate_notes(
    content: Dict[str, Any],
    target_language: str,
    note_type: str = "summary",
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """
    Translates an existing structured note dictionary to target_language.
    """
    prompt = f"""
Translate all text values in the following JSON object to language: {target_language}.
Do NOT translate the JSON keys. Keep the structure identical.

Original JSON:
{json.dumps(content, ensure_ascii=False)}

Output ONLY valid JSON.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.1,
    )

    raw_json = _generate_with_fallback(contents=prompt, config=config)

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_json.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        translated_content = json.loads(cleaned)
    except Exception:
        translated_content = content

    labels = {k: k.replace("_", " ").title() for k in translated_content.keys()}
    return translated_content, labels


# ============================================================================
# Chat with Note
# ============================================================================

def chat_with_note(note_data: Dict[str, Any], question: str) -> str:
    """
    Answers questions based on the generated note context.
    """
    prompt = f"""
Context Notes:
{json.dumps(note_data, ensure_ascii=False, indent=2)}

User Question:
{question}

Answer the user's question directly, clearly, and concisely based strictly on the provided notes context.
"""
    return _generate_with_fallback(contents=prompt)


# ============================================================================
# Task Extraction
# ============================================================================

def extract_tasks(transcript: str) -> List[Dict[str, Any]]:
    """
    Extracts action items, deadlines, priorities, and assignees from a transcript.
    """
    prompt = f"""
Analyze the following transcript and extract actionable tasks and commitments.

Transcript:
{transcript}

Return a JSON array of objects with the following schema:
[
  {{
    "title": "Task title",
    "description": "Brief description of the action item",
    "priority": "High | Medium | Low",
    "deadline": "YYYY-MM-DD or specific deadline text if mentioned, else null",
    "assigned_to": "Person responsible or null"
  }}
]

Return ONLY valid JSON. No markdown backticks.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )

    raw_json = _generate_with_fallback(contents=prompt, config=config)

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_json.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        tasks = json.loads(cleaned)
        if isinstance(tasks, list):
            return tasks
        return []
    except Exception:
        return []


# ============================================================================
# Visual Frame Analysis
# ============================================================================

def analyze_frame(frame_path: str, timestamp: float = 0.0) -> Dict[str, Any]:
    """
    Analyzes an extracted video keyframe image using Gemini Vision.
    """
    client = _get_client()
    image_file = client.files.upload(file=frame_path)

    prompt = f"""
Analyze this keyframe image extracted from a video at timestamp {int(timestamp)} seconds.
Identify visual information such as code blocks, slides, diagrams, charts, or visible text.

Return a JSON object in this format:
{{
  "type": "code | slide | diagram | chart | visual",
  "title": "Brief title summarizing this frame",
  "description": "Detailed explanation of visual contents",
  "extracted_text": "Any readable text on the slide or diagram",
  "code": "Extract any visible source code verbatim, else null"
}}

Return ONLY valid JSON.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.1,
    )

    try:
        raw_json = _generate_with_fallback(contents=[image_file, prompt], config=config)
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_json.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)
        analysis = json.loads(cleaned)
    except Exception:
        analysis = {
            "type": "visual",
            "title": f"Keyframe at {int(timestamp)}s",
            "description": "Visual frame captured from video.",
            "extracted_text": "",
            "code": "",
        }
    finally:
        try:
            client.files.delete(name=image_file.name)
        except Exception:
            pass

    return analysis