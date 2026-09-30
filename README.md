# AI-Powered Smart Transcription and Content Abstraction Platform

A full-stack academic/project implementation for converting audio and video into transcripts and four specialized note types: **Summary, Meeting, Lecture, and Task**.

## Implemented modules

1. Audio/video upload
2. FFmpeg audio extraction from video
3. Whisper transcription with automatic language detection / selected speech language
4. Transcript editing/testing
5. AI content abstraction using Gemini
6. Four note types with dedicated JSON schemas
7. **English notes by default with multilingual note generation and translation**
8. **Complete note-language switching, including translated section labels and nested task fields**
9. AI chat with generated notes
10. Automatic task/action-item extraction
11. Local task database
12. Reminder storage
13. Optional Google Calendar OAuth + event creation
14. **Automatic representative-frame extraction for long videos**
15. **Automatic Gemini visual analysis for diagrams, code, slides, images, tables and visible text**
16. **Speech context associated with detected visual frames using timestamped Whisper segments**
17. Multimedia cards with timestamp, explanation, extracted text and copyable code
18. Export notes to PDF, DOCX, TXT and JSON
19. WebSocket real-time collaboration rooms
20. SQLite persistence
21. Cinematic Crimson Sunset frontend
22. Responsive React + Vite interface

## Important setup

### Recommended Python
Use **Python 3.12** for the backend. Python 3.14 can cause compatibility issues with some speech/ML dependencies.

### 1. Backend

```powershell
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Install **FFmpeg** separately and make sure `ffmpeg -version` works in a new terminal.

Copy `.env.example` to `.env` and set:

```env
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.5-flash
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

Run:

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0
```

Backend: http://127.0.0.1:8000
Swagger: http://127.0.0.1:8000/docs

### 2. Frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

For LAN collaboration, open the Vite **Network** URL on the other computer. The backend should be started with `--host 0.0.0.0` so other devices can reach port 8000.

## Note language behavior

- The default **Note Language** is **English**.
- The **Transcription Language** is separate and controls Whisper speech recognition.
- Users can select a different note language before generating notes.
- Users can change the language of an already generated note from **My Notes** without reprocessing the media.
- Translation preserves the note JSON structure, facts, numbers, names, deadlines and technical identifiers.
- Section labels and nested task/action fields are translated as well.

Example:

```text
Video language: English
Note language: Kannada

Transcript -> English
Notes -> Kannada
```

## Automatic multimedia extraction

For a video, after transcription the frontend automatically starts visual analysis in the background.

The backend:

```text
Video
  -> representative frame sampling
  -> duplicate/low-change filtering
  -> Whisper timestamp context
  -> Gemini visual analysis
  -> meaningful visual items
```

Gemini classifies meaningful frames as items such as:

- Diagram
- Code
- Slide
- Image
- Chart
- Table
- Text

Code frames can include extracted code and language. Diagram/slide frames can include a description, visible text and the nearby spoken explanation.

### Long-video optimization

The frame extractor uses bounded representative sampling instead of extracting every video frame. The current implementation targets a maximum of 36 candidate frames and uses visual-change filtering. This keeps 1–2 hour videos much more manageable than processing every frame.

## Four note schemas

### Summary
- Title
- Overview
- Main Points
- Key Insights
- Important Details
- Conclusion

### Meeting
- Meeting Title
- Agenda
- Discussion Points
- Decisions Made
- Action Items
- Important Follow-ups
- Next Meeting

### Lecture
- Subject
- Topic
- Learning Objectives
- Main Concepts
- Detailed Explanation
- Important Definitions
- Examples
- Key Points
- Quick Revision

### Task
- Task Title
- Description
- Tasks
- Required Actions
- Deadlines
- Next Steps

## API overview

- `POST /api/upload`
- `POST /api/transcribe/{media_id}`
- `POST /api/generate-notes`
- `GET /api/notes`
- `GET /api/notes/{note_id}`
- `POST /api/notes/{note_id}/translate`
- `POST /api/chat`
- `POST /api/tasks/extract/{media_id}`
- `GET /api/tasks`
- `POST /api/reminders`
- `GET /api/calendar/auth`
- `GET /api/calendar/callback`
- `POST /api/media/extract-frames/{media_id}`
- `GET /api/export/{note_id}/{format}`
- `WS /api/collaboration/{room}`

## Google Calendar

Google Calendar is implemented as an optional integration. To use it, create OAuth credentials in Google Cloud, place the downloaded credential file at `backend/credentials.json`, then open `/api/calendar/auth` from the running backend. After OAuth approval, reminders can be created as calendar events.

## Security

Do not commit `.env`, `credentials.json`, generated media, or the SQLite database. These are excluded through `.gitignore`.


## Real-time collaboration

The Collaboration page supports room-based collaboration with: 

- A first-run username prompt stored in the browser
- Create a room with a short room ID
- Join using a room ID
- Direct invite links in the form `/collab/<ROOM_ID>`
- Live online-user presence over FastAPI WebSockets
- Room discussion messages
- Browser-to-browser voice communication using WebRTC
- Mute/unmute and leave-voice controls

Voice audio is not sent through the FastAPI server. FastAPI WebSockets are used for room presence and WebRTC signaling. WebRTC uses public Google STUN servers in the frontend to help peers discover a direct connection. A TURN server may be added later for networks where direct peer connectivity is unavailable.

### Sharing with another computer on the same network

Start Vite with the configured LAN host support (`host: true`). Open the Network URL shown by Vite on the other computer, then share the generated `/collab/<ROOM_ID>` link. The backend must be reachable on port 8000 from that computer, and Windows Firewall may need to allow Python/Uvicorn on the local network.
