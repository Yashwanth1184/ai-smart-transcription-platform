import os
import uuid
import json
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.models.models import Media, Note, Task, Reminder
from app.services.ai import (
    generate_notes,
    chat_with_note,
    extract_tasks,
    analyze_frame,
    translate_notes,
)
from app.services.exporter import export_note
from app.services.media import extract_audio, extract_frames, is_video
from app.services.transcription import transcribe

# Safe import for calendar functions to prevent startup crashes
try:
    from app.services import calendar_service
    if hasattr(calendar_service, "get_calendar_auth_url"):
        get_calendar_auth_url = calendar_service.get_calendar_auth_url
    elif hasattr(calendar_service, "get_auth_url"):
        get_calendar_auth_url = calendar_service.get_auth_url
    else:
        def get_calendar_auth_url():
            return None
except Exception:
    def get_calendar_auth_url():
        return None

router = APIRouter(prefix="/api")


# ============================================================================
# Pydantic Schemas
# ============================================================================

class GenerateNotesRequest(BaseModel):
    media_id: int
    note_type: str = "summary"
    note_language: str = "en"


class TranslateNoteRequest(BaseModel):
    target_language: str


class ChatRequest(BaseModel):
    note_id: int
    question: str


class CreateReminderRequest(BaseModel):
    task_id: int
    remind_at: str
    add_to_calendar: bool = False


# ============================================================================
# Media & Upload Endpoints
# ============================================================================

@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lower()
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    destination = os.path.join(settings.upload_dir, unique_filename)

    with open(destination, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    media_type = "video" if is_video(destination) else "audio"

    media = Media(
        filename=file.filename or unique_filename,
        file_path=destination,
        media_type=media_type,
    )
    db.add(media)
    db.commit()
    db.refresh(media)

    return {
        "id": media.id,
        "filename": media.filename,
        "media_type": media.media_type,
        "created_at": media.created_at.isoformat() if media.created_at else None,
    }


@router.post("/transcribe/{media_id}")
def transcribe_media(
    media_id: int,
    language: Optional[str] = None,
    db: Session = Depends(get_db),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found.")

    audio_path = media.file_path
    if media.media_type == "video":
        audio_path = extract_audio(media.file_path, settings.output_dir)

    try:
        lang_arg = None if language in ("auto", "", None) else language
        result = transcribe(audio_path, language=lang_arg)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}",
        )

    media.transcript = result.get("text", "")
    db.commit()

    return {
        "media_id": media.id,
        "text": media.transcript,
        "language": result.get("language", "en"),
        "segments": result.get("segments", []),
    }


# ============================================================================
# Multimedia Analysis (Optimized for Render Free Tier)
# ============================================================================

@router.post("/media/extract-frames/{media_id}")
def extract_media_frames(
    media_id: int,
    db: Session = Depends(get_db),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found.")

    if media.media_type != "video":
        raise HTTPException(
            status_code=400,
            detail="Media is not a video file.",
        )

    out_dir = os.path.join(settings.output_dir, f"frames_{media.id}")
    os.makedirs(out_dir, exist_ok=True)

    try:
        raw_frames = extract_frames(
            media.file_path,
            out_dir=out_dir,
            every_seconds=45,
            max_frames=8,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Frame extraction failed: {str(e)}",
        )

    results = []
    for item in raw_frames[:6]:
        frame_path = item.get("path")
        rel_url = f"/storage/outputs/frames_{media.id}/{os.path.basename(frame_path)}"
        timestamp = item.get("timestamp", 0.0)

        try:
            analysis = analyze_frame(frame_path, timestamp=timestamp)
        except Exception:
            analysis = {
                "type": "visual",
                "title": f"Keyframe at {int(timestamp)}s",
                "description": "Visual snapshot captured from video.",
                "extracted_text": "",
                "code": "",
            }

        results.append({
            "filename": os.path.basename(frame_path),
            "url": rel_url,
            "timestamp": timestamp,
            "difference": item.get("difference", 0.0),
            "analysis": analysis,
        })

    return {"media_id": media.id, "frames": results}


# ============================================================================
# Notes Generation & Chat
# ============================================================================

@router.post("/generate-notes")
def api_generate_notes(
    req: GenerateNotesRequest,
    db: Session = Depends(get_db),
):
    media = db.query(Media).filter(Media.id == req.media_id).first()
    if not media or not media.transcript:
        raise HTTPException(
            status_code=400,
            detail="Valid transcript is required before generating notes.",
        )

    try:
        content, labels = generate_notes(
            transcript=media.transcript,
            note_type=req.note_type,
            note_language=req.note_language,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI note generation failed: {str(e)}")

    note = Note(
        media_id=media.id,
        title=content.get("title") or f"{req.note_type.title()} Notes",
        note_type=req.note_type,
        note_language=req.note_language,
        content_json=json.dumps(content),
        note_labels_json=json.dumps(labels),
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return {
        "id": note.id,
        "title": note.title,
        "note_type": note.note_type,
        "note_language": note.note_language,
        "content": content,
        "labels": labels,
    }


@router.post("/notes/{note_id}/translate")
def api_translate_note(
    note_id: int,
    req: TranslateNoteRequest,
    db: Session = Depends(get_db),
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    current_content = json.loads(note.content_json or "{}")

    try:
        translated_content, labels = translate_notes(
            content=current_content,
            target_language=req.target_language,
            note_type=note.note_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")

    note.content_json = json.dumps(translated_content)
    note.note_language = req.target_language
    note.note_labels_json = json.dumps(labels)
    db.commit()

    return {
        "id": note.id,
        "title": note.title,
        "note_type": note.note_type,
        "note_language": note.note_language,
        "content": translated_content,
        "labels": labels,
    }


@router.get("/notes")
def list_notes(db: Session = Depends(get_db)):
    notes = db.query(Note).order_by(Note.created_at.desc()).all()
    out = []
    for n in notes:
        out.append({
            "id": n.id,
            "title": n.title,
            "note_type": n.note_type,
            "note_language": n.note_language,
            "content": json.loads(n.content_json or "{}"),
            "labels": json.loads(n.note_labels_json or "{}"),
            "created_at": n.created_at.isoformat() if n.created_at else None,
        })
    return out


@router.post("/chat")
def api_chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
):
    note = db.query(Note).filter(Note.id == req.note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    note_data = json.loads(note.content_json or "{}")
    try:
        answer = chat_with_note(note_data, req.question)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

    return {"answer": answer}


# ============================================================================
# Tasks & Reminders
# ============================================================================

@router.post("/tasks/extract/{media_id}")
def api_extract_tasks(
    media_id: int,
    db: Session = Depends(get_db),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media or not media.transcript:
        raise HTTPException(status_code=400, detail="Transcript is required.")

    try:
        items = extract_tasks(media.transcript)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Task extraction failed: {str(e)}")

    created = []
    for it in items:
        t = Task(
            media_id=media.id,
            title=it.get("title", "Task"),
            description=it.get("description", ""),
            priority=it.get("priority", "Medium"),
            deadline=it.get("deadline"),
            assigned_to=it.get("assigned_to"),
        )
        db.add(t)
        created.append(t)
    db.commit()

    return {"count": len(created)}


@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.id.desc()).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "priority": t.priority,
            "deadline": t.deadline,
            "assigned_to": t.assigned_to,
            "status": t.status,
        }
        for t in tasks
    ]


@router.post("/reminders")
def create_reminder(
    req: CreateReminderRequest,
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == req.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    r = Reminder(
        task_id=task.id,
        remind_at=req.remind_at,
        add_to_calendar=req.add_to_calendar,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "status": "scheduled"}


@router.get("/calendar/auth")
def calendar_auth():
    url = None
    try:
        url = get_calendar_auth_url()
    except Exception:
        pass

    if not url:
        return {"authorization_url": "https://accounts.google.com/o/oauth2/v2/auth"}
    return {"authorization_url": url}


# ============================================================================
# Exports
# ============================================================================

@router.get("/export/{note_id}/{format}")
def api_export_note(
    note_id: int,
    format: str,
    db: Session = Depends(get_db),
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    fmt = format.lower()
    if fmt not in ("pdf", "docx", "txt", "json"):
        raise HTTPException(status_code=400, detail="Unsupported export format.")

    try:
        return export_note(note, fmt, output_dir=settings.output_dir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


# ============================================================================
# Collaboration (Rooms & WebRTC / WebSocket Signaling)
# ============================================================================

class CollaborationManager:
    def __init__(self):
        self.rooms: Dict[str, List[dict]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = []

    def disconnect(self, room_id: str, websocket: WebSocket):
        if room_id in self.rooms:
            self.rooms[room_id] = [
                client for client in self.rooms[room_id] if client["ws"] != websocket
            ]
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_room_state(self, room_id: str):
        if room_id not in self.rooms:
            return
        user_list = [
            {
                "user_id": c.get("user_id", ""),
                "user_name": c.get("user_name", "User"),
                "voice_enabled": c.get("voice_enabled", False),
            }
            for c in self.rooms[room_id]
        ]
        payload = json.dumps({"type": "room_state", "users": user_list})
        for c in self.rooms[room_id]:
            try:
                await c["ws"].send_text(payload)
            except Exception:
                pass

    async def send_to_user(self, room_id: str, target_user_id: str, payload: dict):
        if room_id not in self.rooms:
            return
        raw = json.dumps(payload)
        for c in self.rooms[room_id]:
            if c.get("user_id") == target_user_id:
                try:
                    await c["ws"].send_text(raw)
                except Exception:
                    pass
                break

    async def broadcast(self, room_id: str, payload: dict):
        if room_id not in self.rooms:
            return
        raw = json.dumps(payload)
        for c in self.rooms[room_id]:
            try:
                await c["ws"].send_text(raw)
            except Exception:
                pass


manager = CollaborationManager()


@router.post("/collaboration/rooms")
def create_room():
    room_id = uuid.uuid4().hex[:6].upper()
    return {"room_id": room_id}


@router.websocket("/collaboration/{room_id}")
async def collaboration_ws(websocket: WebSocket, room_id: str):
    normalized_room = room_id.strip().upper()
    await manager.connect(normalized_room, websocket)
    client_entry = {
        "ws": websocket,
        "user_id": "",
        "user_name": "User",
        "voice_enabled": False,
    }
    manager.rooms[normalized_room].append(client_entry)

    try:
        while True:
            text_data = await websocket.receive_text()
            data = json.loads(text_data)
            msg_type = data.get("type")

            if msg_type == "join":
                client_entry["user_id"] = data.get("user_id", "")
                client_entry["user_name"] = data.get("user_name", "User")
                await manager.broadcast_room_state(normalized_room)

            elif msg_type == "voice_state":
                client_entry["voice_enabled"] = bool(data.get("enabled", False))
                await manager.broadcast_room_state(normalized_room)

            elif msg_type == "signal":
                target = data.get("target")
                if target:
                    await manager.send_to_user(
                        normalized_room,
                        target,
                        {
                            "type": "signal",
                            "from": client_entry.get("user_id"),
                            "signal": data.get("signal"),
                        },
                    )

            elif msg_type == "room_message":
                await manager.broadcast(
                    normalized_room,
                    {
                        "type": "room_message",
                        "user_name": client_entry.get("user_name"),
                        "message": data.get("message", ""),
                    },
                )

    except WebSocketDisconnect:
        manager.disconnect(normalized_room, websocket)
        await manager.broadcast_room_state(normalized_room)
    except Exception:
        manager.disconnect(normalized_room, websocket)
        await manager.broadcast_room_state(normalized_room)