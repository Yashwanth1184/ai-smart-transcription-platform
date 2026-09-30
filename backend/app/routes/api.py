import os, json, uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.config import settings
from app.db.database import get_db
from app.models.models import Media, Note, Task, ChatMessage, Reminder
from app.services.media import is_video, extract_audio, extract_frames, extract_code_blocks
from app.services.transcription import transcribe
from app.services.ai import generate_notes, generate_note_labels, translate_notes, chat_with_note, extract_tasks, analyze_frame
from app.services.exporter import export_docx, export_pdf, export_txt, export_ics
from app.services.calendar_service import authorization_url, callback as calendar_callback, create_event

router=APIRouter(prefix="/api")
os.makedirs(settings.upload_dir,exist_ok=True); os.makedirs(settings.output_dir,exist_ok=True)

class NoteRequest(BaseModel):
    media_id:int
    note_type:str
    note_language:str = "en"

class TranslateNoteRequest(BaseModel):
    target_language:str = "en"
class ChatRequest(BaseModel):
    note_id:int
    question:str
class ReminderRequest(BaseModel):
    task_id:int
    remind_at:str
    add_to_calendar:bool=False

@router.post("/upload")
async def upload(file:UploadFile=File(...), db:Session=Depends(get_db)):
    ext=Path(file.filename or "").suffix.lower()
    allowed={".mp3",".wav",".m4a",".aac",".flac",".ogg",".mp4",".mov",".webm",".mkv",".avi"}
    if ext not in allowed: raise HTTPException(400,"Unsupported audio/video format")
    name=f"{uuid.uuid4().hex}{ext}"; path=os.path.join(settings.upload_dir,name)
    with open(path,"wb") as f:
        while chunk:=await file.read(1024*1024): f.write(chunk)
    media=Media(original_name=file.filename,file_path=path,media_type="video" if is_video(path) else "audio")
    db.add(media); db.commit(); db.refresh(media)
    return {"id":media.id,"filename":media.original_name,"media_type":media.media_type,"status":media.status}

@router.post("/transcribe/{media_id}")
def transcribe_media(media_id:int, language:str|None=None, db:Session=Depends(get_db)):
    media=db.get(Media,media_id)
    if not media: raise HTTPException(404,"Media not found")
    try:
        audio=extract_audio(media.file_path,settings.upload_dir) if media.media_type=="video" else media.file_path
        result=transcribe(audio,language)
        media.transcript=result["text"]; media.language=result["language"]; media.status="transcribed"; db.commit()
        # Keep timestamped segments outside the main transcript column so visual
        # analysis can associate a frame with the speech near that timestamp.
        segments_path=os.path.join(settings.output_dir, f"media_{media_id}_segments.json")
        with open(segments_path, "w", encoding="utf-8") as sf:
            json.dump(result.get("segments", []), sf, ensure_ascii=False)
        return result
    except FileNotFoundError: raise HTTPException(500,"FFmpeg was not found on PATH. Install FFmpeg and restart the terminal.")
    except Exception as e: raise HTTPException(500,str(e))

@router.post("/generate-notes")
def notes(req:NoteRequest, db:Session=Depends(get_db)):
    media=db.get(Media,req.media_id)
    if not media or not media.transcript: raise HTTPException(400,"Transcribe the media first")
    try:
        data=generate_notes(media.transcript,req.note_type,req.note_language)
        try:
            labels=generate_note_labels(req.note_type,req.note_language)
        except Exception:
            labels={}
    except Exception as e: raise HTTPException(500,str(e))
    note=Note(media_id=media.id,note_type=req.note_type,note_language=req.note_language,note_labels_json=json.dumps(labels,ensure_ascii=False),title=data.get("title") or data.get("meeting_title") or data.get("task_title") or data.get("topic"),content_json=json.dumps(data,ensure_ascii=False))
    db.add(note); db.commit(); db.refresh(note)
    return {"id":note.id,"note_type":note.note_type,"note_language":req.note_language,"labels":labels,"content":data}

@router.get("/notes")
def list_notes(db:Session=Depends(get_db)):
    rows=db.query(Note).order_by(Note.id.desc()).all()
    return [{"id":n.id,"media_id":n.media_id,"note_type":n.note_type,"note_language":n.note_language or "en","labels":json.loads(n.note_labels_json or "{}"),"title":n.title,"content":json.loads(n.content_json),"created_at":str(n.created_at)} for n in rows]

@router.get("/notes/{note_id}")
def get_note(note_id:int,db:Session=Depends(get_db)):
    n=db.get(Note,note_id)
    if not n: raise HTTPException(404,"Note not found")
    return {"id":n.id,"media_id":n.media_id,"note_type":n.note_type,"note_language":n.note_language or "en","labels":json.loads(n.note_labels_json or "{}"),"title":n.title,"content":json.loads(n.content_json)}

@router.post("/notes/{note_id}/translate")
def translate_note(note_id:int,req:TranslateNoteRequest,db:Session=Depends(get_db)):
    n=db.get(Note,note_id)
    if not n: raise HTTPException(404,"Note not found")
    try:
        data=translate_notes(json.loads(n.content_json),req.target_language)
        try:
            labels=generate_note_labels(n.note_type,req.target_language)
        except Exception:
            labels={}
    except Exception as e:
        raise HTTPException(500,str(e))
    n.content_json=json.dumps(data,ensure_ascii=False)
    n.note_language=req.target_language
    n.note_labels_json=json.dumps(labels,ensure_ascii=False)
    n.title=data.get("title") or data.get("meeting_title") or data.get("task_title") or data.get("topic")
    db.commit(); db.refresh(n)
    return {"id":n.id,"note_type":n.note_type,"note_language":req.target_language,"labels":labels,"title":n.title,"content":data,"language":req.target_language}

@router.post("/chat")
def chat(req:ChatRequest,db:Session=Depends(get_db)):
    note=db.get(Note,req.note_id)
    if not note: raise HTTPException(404,"Note not found")
    media=db.get(Media,note.media_id) if note.media_id else None
    try: answer=chat_with_note(media.transcript if media else "",json.loads(note.content_json),req.question)
    except Exception as e: raise HTTPException(500,str(e))
    db.add(ChatMessage(note_id=note.id,role="user",content=req.question)); db.add(ChatMessage(note_id=note.id,role="assistant",content=answer)); db.commit()
    return {"answer":answer}

@router.post("/tasks/extract/{media_id}")
def tasks(media_id:int,db:Session=Depends(get_db)):
    media=db.get(Media,media_id)
    if not media or not media.transcript: raise HTTPException(400,"Transcript required")
    try: items=extract_tasks(media.transcript)
    except Exception as e: raise HTTPException(500,str(e))
    saved=[]
    for x in items:
        t=Task(media_id=media.id,title=x.get("title","Untitled task"),description=x.get("description",""),assigned_to=x.get("assigned_to",""),deadline=x.get("deadline",""),priority=x.get("priority","Medium"),status=x.get("status","Pending")); db.add(t); db.flush(); saved.append(t.id)
    db.commit()
    return {"tasks":[{"id":t.id,"title":t.title,"description":t.description,"assigned_to":t.assigned_to,"deadline":t.deadline,"priority":t.priority,"status":t.status} for t in db.query(Task).filter(Task.id.in_(saved)).all()]}

@router.get("/tasks")
def list_tasks(db:Session=Depends(get_db)):
    return [{"id":t.id,"title":t.title,"description":t.description,"assigned_to":t.assigned_to,"deadline":t.deadline,"priority":t.priority,"status":t.status} for t in db.query(Task).order_by(Task.id.desc()).all()]

@router.get("/reminders")
def list_reminders(db:Session=Depends(get_db)):
    return [{"id":r.id,"task_id":r.task_id,"title":r.title,"remind_at":r.remind_at,"status":r.status,"calendar_event_id":r.calendar_event_id} for r in db.query(Reminder).order_by(Reminder.id.desc()).all()]

@router.post("/reminders")
def reminder(req:ReminderRequest,db:Session=Depends(get_db)):
    task=db.get(Task,req.task_id)
    if not task: raise HTTPException(404,"Task not found")
    r=Reminder(task_id=task.id,title=task.title,remind_at=req.remind_at); db.add(r); db.commit(); db.refresh(r)
    if req.add_to_calendar:
        try:
            ev=create_event(task.title,req.remind_at,task.description); r.calendar_event_id=ev.get("id",""); db.commit()
        except Exception as e: raise HTTPException(400,str(e))
    return {"id":r.id,"status":r.status,"calendar_event_id":r.calendar_event_id}

@router.get("/calendar/auth")
def calendar_auth():
    try: url,state=authorization_url(); return {"authorization_url":url,"state":state}
    except Exception as e: raise HTTPException(400,str(e))

@router.get("/calendar/callback")
def calendar_cb(code:str):
    try: calendar_callback(code); return {"status":"connected","message":"Google Calendar connected. You can close this tab."}
    except Exception as e: raise HTTPException(400,str(e))

@router.post("/media/extract-frames/{media_id}")
def frames(media_id:int,db:Session=Depends(get_db)):
    media=db.get(Media,media_id)
    if not media or media.media_type!="video": raise HTTPException(400,"A video is required")
    out=os.path.join(settings.output_dir,f"media_{media_id}_frames")
    rows=extract_frames(media.file_path,out,every_seconds=60,max_frames=120)

    segments=[]
    segments_path=os.path.join(settings.output_dir, f"media_{media_id}_segments.json")
    if os.path.exists(segments_path):
        try:
            with open(segments_path,"r",encoding="utf-8") as sf:
                segments=json.load(sf)
        except Exception:
            segments=[]

    def spoken_context(timestamp:float):
        if not segments: return ""
        nearby=[]
        for seg in segments:
            start=float(seg.get("start",0)); end=float(seg.get("end",start))
            if start <= timestamp + 12 and end >= timestamp - 12:
                nearby.append(seg.get("text", ""))
        return " ".join(x for x in nearby if x)[:1800]

    analyzed=[]
    for r in rows:
        item={"timestamp":r["timestamp"],"file":r["path"]}
        if settings.gemini_api_key:
            try:
                item["analysis"]=analyze_frame(r["path"], spoken_context(r["timestamp"]), r["timestamp"])
            except Exception as e:
                item["analysis"]={"error":str(e)}
        analyzed.append(item)

    # Only expose meaningful visual items in the automatic multimedia list.
    meaningful=[]
    for x in analyzed:
        a=x.get("analysis") or {}
        if a.get("error"):
            continue
        if a.get("has_visual") is False:
            continue
        if not settings.gemini_api_key and not a:
            meaningful.append(x)
        elif a:
            meaningful.append(x)

    return {"frames":[
        {
            "timestamp":x["timestamp"],
            "filename":os.path.basename(x["path"]),
            "url":"/storage/outputs/" + os.path.relpath(x["path"], settings.output_dir).replace(os.sep, "/"),
            "analysis":x.get("analysis")
        } for x in meaningful
    ]}

@router.get("/export/{note_id}/{format}")
def export_note(note_id:int,format:str,db:Session=Depends(get_db)):
    note=db.get(Note,note_id)
    if not note: raise HTTPException(404,"Note not found")
    data=json.loads(note.content_json); safe=f"note_{note_id}"
    if format=="json": path=os.path.join(settings.output_dir,safe+".json"); open(path,"w",encoding="utf8").write(json.dumps(data,ensure_ascii=False,indent=2))
    elif format=="txt": path=os.path.join(settings.output_dir,safe+".txt"); export_txt(data,path)
    elif format=="docx": path=os.path.join(settings.output_dir,safe+".docx"); export_docx(data,path)
    elif format=="pdf": path=os.path.join(settings.output_dir,safe+".pdf"); export_pdf(data,path)
    else: raise HTTPException(400,"format must be json, txt, docx or pdf")
    return FileResponse(path,filename=os.path.basename(path))

class ConnectionManager:
    def __init__(self):
        # In-memory room state is enough for a local/college-project deployment.
        # Notes/transcripts remain in the database; this manager only handles
        # live presence and WebRTC signaling.
        self.rooms: dict[str, dict[str, dict]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self.rooms.setdefault(room, {})

    async def join(self, room: str, user_id: str, user_name: str, ws: WebSocket):
        self.rooms.setdefault(room, {})[user_id] = {
            "ws": ws, "user_id": user_id, "user_name": user_name or "Guest",
            "voice_enabled": False,
        }
        await self.send_room_state(room)

    async def leave(self, room: str, user_id: str):
        members = self.rooms.get(room, {})
        members.pop(user_id, None)
        if members:
            await self.send_room_state(room)
        else:
            self.rooms.pop(room, None)

    async def send_room_state(self, room: str):
        members = self.rooms.get(room, {})
        payload = {
            "type": "room_state",
            "users": [
                {
                    "user_id": uid,
                    "user_name": item["user_name"],
                    "voice_enabled": bool(item.get("voice_enabled", False)),
                }
                for uid, item in members.items()
            ]
        }
        await self.broadcast(room, payload)

    async def set_voice(self, room: str, user_id: str, enabled: bool):
        member = self.rooms.get(room, {}).get(user_id)
        if not member:
            return
        member["voice_enabled"] = bool(enabled)
        await self.send_room_state(room)

    async def send_to(self, room: str, user_id: str, message: dict):
        member = self.rooms.get(room, {}).get(user_id)
        if not member:
            return
        try:
            await member["ws"].send_json(message)
        except Exception:
            await self.leave(room, user_id)

    async def broadcast(self, room: str, message: dict, exclude: str | None = None):
        for uid, member in list(self.rooms.get(room, {}).items()):
            if uid == exclude:
                continue
            try:
                await member["ws"].send_json(message)
            except Exception:
                await self.leave(room, uid)

manager = ConnectionManager()

@router.post("/collaboration/rooms")
async def create_collaboration_room():
    # Short room IDs are easier to type and share than UUIDs.
    room = uuid.uuid4().hex[:8].upper()
    manager.rooms.setdefault(room, {})
    return {"room_id": room, "share_path": f"/collab/{room}"}

@router.get("/collaboration/rooms/{room}")
async def collaboration_room_info(room: str):
    room = room.strip().upper()
    return {
        "room_id": room,
        "exists": room in manager.rooms,
        "users": [
            {"user_id": uid, "user_name": item["user_name"]}
            for uid, item in manager.rooms.get(room, {}).items()
        ],
    }

@router.websocket("/collaboration/{room}")
async def collaboration(ws: WebSocket, room: str):
    room = room.strip().upper()
    await manager.connect(ws, room)
    user_id = None
    try:
        while True:
            data = await ws.receive_json()
            message_type = data.get("type")

            if message_type == "join":
                user_id = str(data.get("user_id") or uuid.uuid4().hex)
                user_name = str(data.get("user_name") or "Guest")[:80]
                await manager.join(room, user_id, user_name, ws)

            elif message_type == "signal":
                # WebRTC SDP offers/answers and ICE candidates are private
                # signaling messages. They are routed only to the target peer.
                target = str(data.get("target") or "")
                if target:
                    await manager.send_to(room, target, {
                        "type": "signal",
                        "from": user_id,
                        "signal": data.get("signal", {}),
                    })

            elif message_type == "voice_state":
                await manager.set_voice(room, user_id, bool(data.get("enabled", False)))

            elif message_type == "room_message":
                await manager.broadcast(room, {
                    "type": "room_message",
                    "from": user_id,
                    "user_name": data.get("user_name", "Guest"),
                    "message": str(data.get("message", ""))[:2000],
                })

    except WebSocketDisconnect:
        if user_id:
            await manager.leave(room, user_id)
        elif not manager.rooms.get(room):
            manager.rooms.pop(room, None)
    except Exception:
        if user_id:
            await manager.leave(room, user_id)
