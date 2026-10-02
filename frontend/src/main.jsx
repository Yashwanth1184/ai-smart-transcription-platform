
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Home, Upload, FileText, MessageCircle, CheckSquare, Download, Settings,
  Mic, Play, Loader2, Send, Calendar, Image as ImageIcon, Users,
  Copy, ExternalLink, Languages, Code2, BarChart3, FileImage, Type, Link2,
  MicOff, PhoneOff, LogOut, Volume2, UserPlus, ShieldCheck
} from 'lucide-react';
import './styles.css';

// Backend configuration
// Local development:
//   http://127.0.0.1:8000
//
// Production/Vercel frontend + Render backend:
//   Set VITE_API_URL and VITE_SERVER_URL in Vercel environment variables.

const API =
  import.meta.env.VITE_API_URL ||
  'http://127.0.0.1:8000/api';

const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  'http://127.0.0.1:8000';

// Public URL used for collaboration invite links.
// This prevents localhost:5173 from being shared when the app is deployed.
const PUBLIC_FRONTEND_URL =
  import.meta.env.VITE_PUBLIC_FRONTEND_URL ||
  window.location.origin;

const TYPES = {
  summary: { label: 'Summary', desc: 'General overview with key insights' },
  meeting: { label: 'Meeting', desc: 'Decisions, discussions and action items' },
  lecture: { label: 'Lecture', desc: 'Concepts, explanations and revision' },
  task: { label: 'Task', desc: 'Tasks, priorities and deadlines' },
};

const NOTE_LANGUAGES = [
  ['en', 'English'], ['kn', 'Kannada'], ['hi', 'Hindi'], ['te', 'Telugu'],
  ['ta', 'Tamil'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['bn', 'Bengali'],
  ['gu', 'Gujarati'], ['pa', 'Punjabi'], ['or', 'Odia'], ['as', 'Assamese'],
  ['ur', 'Urdu'], ['ne', 'Nepali'], ['fr', 'French'], ['de', 'German'],
  ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'],
  ['zh', 'Chinese']
];

const TRANSCRIPTION_LANGUAGES = [
  ['auto', 'Auto detect'], ['en', 'English'], ['kn', 'Kannada'], ['hi', 'Hindi'],
  ['te', 'Telugu'], ['ta', 'Tamil'], ['ml', 'Malayalam'], ['mr', 'Marathi'],
  ['bn', 'Bengali'], ['gu', 'Gujarati']
];

function App() {
  const [page, setPage] = useState('home');
  const [noteType, setNoteType] = useState('summary');
  const [file, setFile] = useState(null);
  const [media, setMedia] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [note, setNote] = useState(null);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState('');
  const [visualLoading, setVisualLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('auto');
  const [noteLanguage, setNoteLanguage] = useState('en');
  const [error, setError] = useState('');
  const [frames, setFrames] = useState([]);
  const [userName, setUserName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  // Ask for the user's name every time the application is opened.
  // The name is intentionally not persisted in localStorage.
  const [showNameModal, setShowNameModal] = useState(true);
  const [room, setRoom] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [collab, setCollab] = useState(false);
  const [collabStatus, setCollabStatus] = useState('offline');
  const [roomUsers, setRoomUsers] = useState([]);
  const [collabMessage, setCollabMessage] = useState('');
  const [collabMessages, setCollabMessages] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const ws = useRef(null);
  const localStream = useRef(null);
  const peers = useRef({});
  const participantId = useRef(sessionStorage.getItem('ai-smart-notes-participant-id') || crypto.randomUUID());
  const audioRefs = useRef({});
  const iceServers = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ] };
  sessionStorage.setItem('ai-smart-notes-participant-id', participantId.current);

  const api = async (path, opt = {}) => {
    let response;
    try {
      response = await fetch(API + path, opt);
    } catch (e) {
      throw new Error('Cannot connect to backend. Make sure FastAPI is running on http://127.0.0.1:8000.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  };

  const chooseFile = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setMedia(null);
      setTranscript('');
      setNote(null);
      setFrames([]);
      setError('');
    }
  };

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = e => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setFile(new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
      };
      recorder.current = r;
      r.start();
      setRecording(true);
    } catch (e) {
      setError('Microphone access was denied or is unavailable.');
    }
  }

  function stopRecording() { recorder.current?.stop(); }

  async function analyzeMultimedia(mediaId, background = true) {
    if (!mediaId) return;
    setVisualLoading(true);
    try {
      const d = await api(`/media/extract-frames/${mediaId}`, { method: 'POST' });
      setFrames(d.frames || []);
    } catch (e) {
      if (!background) setError(e.message);
      else setError(`Multimedia analysis could not be completed: ${e.message}`);
    } finally {
      setVisualLoading(false);
    }
  }

  async function upload() {
    if (!file) return;
    setLoading('Uploading');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const d = await api('/upload', { method: 'POST', body: fd });
      setMedia(d);

      setLoading('Transcribing');
      const t = await api(`/transcribe/${d.id}${transcriptionLanguage !== 'auto' ? `?language=${transcriptionLanguage}` : ''}`, { method: 'POST' });
      setTranscript(t.text || '');
      setLoading('');
      setPage('home');

      // Visual analysis starts automatically for videos. It runs separately so
      // transcription/note generation does not have to wait for Gemini vision.
      if (d.media_type === 'video') {
        analyzeMultimedia(d.id, true);
      }
    } catch (e) {
      setError(e.message);
      setLoading('');
    }
  }

  async function generate() {
    if (!media?.id || !transcript.trim()) return;
    setLoading(`Generating ${TYPES[noteType].label} notes in ${languageName(noteLanguage)}`);
    setError('');
    try {
      const d = await api('/generate-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: media.id, note_type: noteType, note_language: noteLanguage })
      });
      setNote({ ...d, content: { ...d.content, _language: noteLanguage } });
      setNoteLanguage(noteLanguage);
      setLoading('');
      setPage('notes');
      loadNotes();
    } catch (e) {
      setError(e.message);
      setLoading('');
    }
  }

  async function translateCurrentNote(targetLanguage) {
    if (!note?.id || !targetLanguage) return;
    setLoading(`Translating notes to ${languageName(targetLanguage)}`);
    setError('');
    try {
      const d = await api(`/notes/${note.id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_language: targetLanguage })
      });
      setNote({ ...d, content: { ...d.content, _language: targetLanguage } });
      setNoteLanguage(targetLanguage);
      setLoading('');
      loadNotes();
    } catch (e) {
      setError(e.message);
      setLoading('');
    }
  }

  async function loadNotes() { try { setNotes(await api('/notes')); } catch (e) { setError(e.message); } }
  async function loadTasks() { try { setTasks(await api('/tasks')); } catch (e) { setError(e.message); } }

  async function extractTasks() {
    if (!media?.id) return;
    setLoading('Extracting tasks');
    try {
      await api(`/tasks/extract/${media.id}`, { method: 'POST' });
      await loadTasks();
      setLoading('');
      setPage('tasks');
    } catch (e) { setError(e.message); setLoading(''); }
  }

  async function ask() {
    if (!note || !question.trim()) return;
    const q = question;
    setQuestion('');
    setChat(c => [...c, { role: 'user', content: q }]);
    try {
      const d = await api('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: note.id, question: q })
      });
      setChat(c => [...c, { role: 'assistant', content: d.answer }]);
    } catch (e) { setError(e.message); }
  }

  async function framesExtract() {
    if (!media?.id) {
      setError('Upload and transcribe a video first.');
      return;
    }
    await analyzeMultimedia(media.id, false);
  }

  function exportNote(format) { if (note) window.open(`${API}/export/${note.id}/${format}`, '_blank'); }

  function finishName() {
    const name = nameDraft.trim();

    if (!name) {
      setError('Please enter your name.');
      return;
    }

    setUserName(name);
    setShowNameModal(false);
    setNameDraft('');
    setError('');

    // If this page was opened from a shared collaboration link,
    // join that room immediately after the user enters their name.
    const match = window.location.pathname.match(/^\/collab\/([^/]+)$/i);

    if (match) {
      const sharedRoom = match[1].toUpperCase();
      setRoomInput(sharedRoom);
      setPage('collab');

      setTimeout(() => {
        connectCollab(sharedRoom, name);
      }, 0);
    }
  }

  function closePeer(peerId) {
    const peer = peers.current[peerId];
    if (peer) {
      try { peer.close(); } catch {}
      delete peers.current[peerId];
    }
    setRemoteStreams(prev => { const next = { ...prev }; delete next[peerId]; return next; });
  }

  function sendSignal(target, signal) {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'signal', target, signal }));
    }
  }

  async function createPeer(peerId, initiator = false) {
    if (peerId === participantId.current) return null;
    if (peers.current[peerId]) return peers.current[peerId];
    const pc = new RTCPeerConnection(iceServers);
    peers.current[peerId] = pc;
    if (localStream.current) localStream.current.getTracks().forEach(track => pc.addTrack(track, localStream.current));
    pc.onicecandidate = event => { if (event.candidate) sendSignal(peerId, { type: 'ice', candidate: event.candidate }); };
    pc.ontrack = event => {
      const stream = event.streams?.[0];
      if (stream) setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(peerId);
    };
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(peerId, { type: 'offer', description: pc.localDescription });
    }
    return pc;
  }

  async function handleSignal(message) {
    const from = message.from;
    const signal = message.signal || {};
    if (!from) return;
    if (signal.type === 'offer') {
      const pc = await createPeer(from, false);
      await pc.setRemoteDescription(signal.description);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, { type: 'answer', description: pc.localDescription });
    } else if (signal.type === 'answer') {
      const pc = peers.current[from];
      if (pc) await pc.setRemoteDescription(signal.description);
    } else if (signal.type === 'ice') {
      const pc = peers.current[from] || await createPeer(from, false);
      try { await pc.addIceCandidate(signal.candidate); } catch {}
    }
  }

  function connectCollab(roomId, nameOverride = userName) {
    const normalized = roomId.trim().replace(/^#/, '').toUpperCase();
    const joiningName = (nameOverride || userName || '').trim();

    if (!normalized || !joiningName) return;

    Object.keys(peers.current).forEach(closePeer);
    ws.current?.close();

    setRoom(normalized);
    setRoomInput(normalized);
    setPage('collab');
    setCollabStatus('connecting');
    setCollabMessages([]);

    const wsBase = SERVER
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');

    const socket = new WebSocket(
      `${wsBase}/api/collaboration/${encodeURIComponent(normalized)}`
    );

    ws.current = socket;

    socket.onopen = () => {
      setCollab(true);
      setCollabStatus('online');

      socket.send(JSON.stringify({
        type: 'join',
        user_id: participantId.current,
        user_name: joiningName
      }));
    };

    socket.onmessage = async event => {
      const data = JSON.parse(event.data);

      if (data.type === 'room_state') {
        const users = data.users || [];
        setRoomUsers(users);

        const remoteVoiceIds = new Set(
          users
            .filter(
              u =>
                u.voice_enabled &&
                u.user_id !== participantId.current
            )
            .map(u => u.user_id)
        );

        for (const peerId of Object.keys(peers.current)) {
          if (!remoteVoiceIds.has(peerId) || !localStream.current) {
            closePeer(peerId);
          }
        }

        if (localStream.current) {
          for (const user of users) {
            if (
              user.voice_enabled &&
              user.user_id !== participantId.current &&
              participantId.current < user.user_id
            ) {
              await createPeer(user.user_id, true);
            }
          }
        }
      } else if (data.type === 'signal') {
        await handleSignal(data);
      } else if (data.type === 'room_message') {
        setCollabMessages(prev => [
          ...prev.slice(-49),
          {
            name: data.user_name || 'User',
            message: data.message
          }
        ]);
      }
    };

    socket.onclose = () => {
      setCollab(false);
      setCollabStatus('offline');
      setRoomUsers([]);
    };

    socket.onerror = () => {
      setCollabStatus('error');
      setError(
        'Could not connect to the collaboration server. Check the backend URL and make sure FastAPI is running.'
      );
    };
  }

  async function createRoom() {
    try {
      const d = await api('/collaboration/rooms', { method: 'POST' });
      connectCollab(d.room_id);
    } catch (e) { setError(e.message); }
  }

  function joinRoom() {
    const id = roomInput.trim();
    if (!id) return setError('Enter a room ID.');
    connectCollab(id);
  }

  async function shareRoom() {
    if (!room) return;
    const link = `${PUBLIC_FRONTEND_URL}/collab/${room}`;
    try {
      await navigator.clipboard.writeText(link);
      setError('');
      alert('Collaboration link copied to clipboard.');
    } catch {
      setError(`Share this link: ${link}`);
    }
  }

  async function copyRoomId() {
    if (!room) return;
    try { await navigator.clipboard.writeText(room); alert('Room ID copied.'); } catch {}
  }

  async function toggleVoice() {
    if (!collab) return setError('Join a collaboration room first.');
    if (voiceEnabled) {
      localStream.current?.getTracks().forEach(t => t.stop());
      localStream.current = null;
      Object.keys(peers.current).forEach(closePeer);
      ws.current?.send(JSON.stringify({ type: 'voice_state', enabled: false }));
      setVoiceEnabled(false); setMicMuted(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      localStream.current = stream;
      setVoiceEnabled(true);
      ws.current?.send(JSON.stringify({ type: 'voice_state', enabled: true }));
      for (const user of roomUsers) {
        if (user.voice_enabled && user.user_id !== participantId.current && participantId.current < user.user_id) await createPeer(user.user_id, true);
      }
    } catch (e) { setError('Microphone permission is required for voice communication.'); }
  }

  function toggleMute() {
    const next = !micMuted;
    localStream.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMicMuted(next);
  }

  function leaveRoom() {
    localStream.current?.getTracks().forEach(t => t.stop()); localStream.current = null;
    Object.keys(peers.current).forEach(closePeer);
    ws.current?.close();
    setCollab(false); setVoiceEnabled(false); setMicMuted(false); setRoom(''); setRoomUsers([]); setPage('home');
  }

  function sendCollabMessage() {
    const message = collabMessage.trim();
    if (!message || ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ type: 'room_message', user_name: userName, message }));
    setCollabMessage('');
  }

  useEffect(() => {
    loadNotes();
    loadTasks();

    // A shared /collab/ROOM_ID URL should open the collaboration page,
    // but joining waits until the user has entered their name.
    const match = window.location.pathname.match(/^\/collab\/([^/]+)$/i);

    if (match) {
      const sharedRoom = match[1].toUpperCase();
      setRoomInput(sharedRoom);
      setPage('collab');
      setShowNameModal(true);
    }

    return () => {
      localStream.current?.getTracks().forEach(t => t.stop());
      Object.keys(peers.current).forEach(closePeer);
      ws.current?.close();
    };
  }, []);

  const nav = [
    ['home', Home, 'Home'], ['transcribe', Upload, 'Transcribe'], ['notes', FileText, 'My Notes'],
    ['chat', MessageCircle, 'Chat with Notes'], ['tasks', CheckSquare, 'Tasks & Reminders'],
    ['multimedia', ImageIcon, 'Multimedia'], ['export', Download, 'Export'], ['settings', Settings, 'Settings']
  ];

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><Mic size={28}/><span>AI Smart Notes</span></div>
      {nav.map(([id, I, label]) => <button className={page === id ? 'nav active' : 'nav'} onClick={() => { setPage(id); if (id === 'notes') loadNotes(); if (id === 'tasks') loadTasks(); }} key={id}><I size={18}/>{label}</button>)}
      <div className="side-bottom"><button className={page === 'collab' ? 'nav active' : 'nav'} onClick={() => setPage('collab')}><Users size={18}/>Collab Online</button></div>
    </aside>

    <main className="main">
      <header><div><h1>Transform Audio & Video into Smart Notes</h1><p>Transcribe, understand, organize and act on your content using AI.</p></div><button className="profile profile-button" onClick={() => { setNameDraft(userName); setShowNameModal(true); }} title="Change user name">{userName ? userName.charAt(0).toUpperCase() : "?"}</button></header>
      {error && <div className="error">{error}<button onClick={() => setError('')}>×</button></div>}
      {(loading || visualLoading) && <div className="loading"><Loader2 className="spin" size={18}/>{loading || 'Analyzing multimedia'}...</div>}

      {page === 'home' && <>
        <div className="type-grid">{Object.entries(TYPES).map(([k, v]) => <button key={k} className={`type-card ${noteType === k ? 'selected' : ''}`} onClick={() => setNoteType(k)}><FileText size={24}/><b>{v.label}</b><span>{v.desc}</span></button>)}</div>
        <div className="workspace">
          <section className="panel upload-panel">
            <div className="upload-icon"><Upload size={34}/></div><h2>Upload Audio or Video</h2><p>MP3, WAV, M4A, MP4, MOV, WEBM</p>
            <input id="file" type="file" accept="audio/*,video/*" onChange={chooseFile}/>
            <label htmlFor="file" className="browse">{file ? file.name : 'Choose a file'}</label>
            <label className="select-label">Transcription Language<select value={transcriptionLanguage} onChange={e => setTranscriptionLanguage(e.target.value)}>{TRANSCRIPTION_LANGUAGES.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
            <label className="select-label">Note Language<select value={noteLanguage} onChange={e => setNoteLanguage(e.target.value)}>{NOTE_LANGUAGES.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
            <div className="language-hint"><Languages size={15}/> Notes are generated in English by default. Change Note Language before generating, or translate an existing note later.</div>
            <div className="record-row"><button className="secondary" onClick={recording ? stopRecording : startRecording}>{recording ? '■ Stop Recording' : '● Record Audio'}</button><button className="primary" disabled={!file || loading} onClick={upload}><Play size={18}/>{media ? 'Transcribe Again' : 'Upload & Transcribe'}</button></div>
          </section>
          <section className="panel transcript-panel">
            <div className="panel-head"><span>Transcript</span><small>{noteType.toUpperCase()} mode</small></div>
            <textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Your transcript will appear here after transcription. You can also paste transcript text for testing."/>
            <div className="note-language-row"><Languages size={17}/><b>Generate notes in</b><select value={noteLanguage} onChange={e => setNoteLanguage(e.target.value)}>{NOTE_LANGUAGES.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></div>
            <button className="primary" disabled={!transcript.trim() || loading} onClick={generate}>Generate {TYPES[noteType].label} Notes</button>{media && <button className="secondary" onClick={extractTasks}>Extract Action Items</button>}
            {media?.media_type === 'video' && <div className="visual-status"><ImageIcon size={16}/>{visualLoading ? 'Automatically analyzing diagrams, code, slides and images...' : `${frames.length} visual items detected. Open Multimedia to view them.`}</div>}
          </section>
        </div>
      </>}

      {page === 'transcribe' && <div className="page-panel"><h2>Transcription Workspace</h2><p>Upload a recording, select the speech language or use automatic detection, and transcribe with Whisper.</p><div className="inline"><label className="primary" htmlFor="file-transcribe"><Upload/> Select Media</label><input id="file-transcribe" type="file" accept="audio/*,video/*" onChange={chooseFile}/><select value={transcriptionLanguage} onChange={e => setTranscriptionLanguage(e.target.value)}>{TRANSCRIPTION_LANGUAGES.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></div><textarea className="large-text" value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Transcript..."/></div>}

      {page === 'notes' && <div className="page-panel">
        <div className="toolbar"><h2>My Notes</h2>{note && <div className="toolbar-actions"><select value={noteLanguage} onChange={e => translateCurrentNote(e.target.value)}><option disabled>Note language</option>{NOTE_LANGUAGES.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select><button onClick={() => exportNote('pdf')}>PDF</button><button onClick={() => exportNote('docx')}>DOCX</button><button onClick={() => exportNote('txt')}>TXT</button></div>}</div>
        {note ? <NoteView note={note.content} type={note.note_type} labels={note.labels}/> : notes.length ? <div className="note-list">{notes.map(n => <button key={n.id} onClick={() => { setNote({ ...n, content: { ...(n.content || {}), _language: n.note_language || 'en' } }); setNoteLanguage(n.note_language || 'en'); }}><b>{n.title || n.note_type}</b><span>{n.note_type}</span></button>)}</div> : <Empty text="Generate your first note from a transcript."/>}
      </div>}

      {page === 'chat' && <div className="page-panel"><h2>Chat with Notes</h2><p>Ask questions about the currently generated note.</p><div className="chat-box">{chat.map((m, i) => <div className={m.role === 'user' ? 'bubble user' : 'bubble'} key={i}>{m.content}</div>)}</div><div className="chat-input"><input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about the note..." onKeyDown={e => e.key === 'Enter' && ask()}/><button className="primary" onClick={ask}><Send size={18}/></button></div></div>}

      {page === 'tasks' && <div className="page-panel"><div className="toolbar"><h2>Tasks & Reminders</h2><button className="secondary" onClick={extractTasks} disabled={!media}>Extract from Current Transcript</button></div>{tasks.length ? <div className="task-list">{tasks.map(t => <div className="task" key={t.id}><div><b>{t.title}</b><p>{t.description}</p><small>{t.assigned_to || 'Unassigned'} · {t.priority} · {t.deadline || 'No deadline'}</small></div><button onClick={async () => { const when = prompt('Reminder date/time in ISO format, e.g. 2026-10-01T09:00:00'); if (when) await api('/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: t.id, remind_at: when, add_to_calendar: false }) }); }}><Calendar size={18}/></button></div>)}</div> : <Empty text="No tasks extracted yet."/>}</div>}

      {page === 'multimedia' && <div className="page-panel">
        <div className="toolbar"><div><h2>Multimedia Extraction</h2><p className="muted">Automatically detects meaningful diagrams, code, slides, images, tables and visible text from the video.</p></div><button className="primary" onClick={framesExtract} disabled={!media || visualLoading}>{visualLoading ? 'Analyzing...' : 'Analyze Video'}</button></div>
        {!media && <div className="empty multimedia-empty"><ImageIcon size={42}/><p>Upload and transcribe a video first. Visual content will then be analyzed automatically.</p></div>}
        {media && media.media_type !== 'video' && <div className="empty multimedia-empty"><ImageIcon size={42}/><p>The current media is audio. Upload a video to use automatic multimedia extraction.</p></div>}
        {media?.media_type === 'video' && <>
          <div className="multimedia-summary">
          <span><b>{frames.length}</b> detected items</span>
          <span>
            {visualLoading
              ? 'Gemini visual analysis in progress'
              : frames.length > 0
                ? 'Analysis complete'
                : 'No analysis results yet'}
          </span>
        </div>
          {frames.length ? <div className="frames">{frames.map((f, index) => <MultimediaCard key={`${f.filename}-${index}`} frame={f}/>)}</div> : !visualLoading && <div className="empty multimedia-empty"><ImageIcon size={42}/><p>No meaningful visual content was detected yet. Click Analyze Video to run the scan again.</p></div>}
        </>}
      </div>}

      {page === 'collab' && <CollaborationPage
        userName={userName}
        room={room}
        roomInput={roomInput}
        setRoomInput={setRoomInput}
        roomUsers={roomUsers}
        collab={collab}
        collabStatus={collabStatus}
        createRoom={createRoom}
        joinRoom={joinRoom}
        shareRoom={shareRoom}
        copyRoomId={copyRoomId}
        leaveRoom={leaveRoom}
        voiceEnabled={voiceEnabled}
        micMuted={micMuted}
        toggleVoice={toggleVoice}
        toggleMute={toggleMute}
        remoteStreams={remoteStreams}
        collabMessages={collabMessages}
        collabMessage={collabMessage}
        setCollabMessage={setCollabMessage}
        sendCollabMessage={sendCollabMessage}
      />}

      {page === 'export' && <div className="page-panel"><h2>Export</h2><p>Select a generated note and export it into common formats.</p><div className="export-grid">{['pdf', 'docx', 'txt', 'json'].map(f => <button key={f} onClick={() => exportNote(f)} disabled={!note}><Download/><b>{f.toUpperCase()}</b></button>)}</div></div>}

      {page === 'settings' && <div className="page-panel"><h2>Settings</h2><div className="setting"><b>Whisper model</b><span>Configured in backend/.env (recommended: small for CPU)</span></div><div className="setting"><b>Gemini</b><span>Set GEMINI_API_KEY in backend/.env</span></div><div className="setting"><b>Google Calendar</b><button onClick={async () => { try { const d = await api('/calendar/auth'); window.open(d.authorization_url, '_blank'); } catch (e) { setError(e.message); } }}>Connect Calendar</button></div></div>}
    </main>
    {showNameModal && <div className="modal-backdrop"><div className="name-modal"><div className="modal-icon"><Mic size={25}/></div><h2>Welcome to AI Smart Notes</h2><p>Enter your name to use notes and real-time collaboration.</p><input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Enter your name" onKeyDown={e => e.key === 'Enter' && finishName()}/><button className="primary" disabled={!nameDraft.trim()} onClick={finishName}>Continue</button></div></div>}
  </div>;
}

function CollaborationPage({
  userName,
  room,
  roomInput,
  setRoomInput,
  roomUsers,
  collab,
  collabStatus,
  createRoom,
  joinRoom,
  shareRoom,
  copyRoomId,
  leaveRoom,
  voiceEnabled,
  micMuted,
  toggleVoice,
  toggleMute,
  remoteStreams,
  collabMessages,
  collabMessage,
  setCollabMessage,
  sendCollabMessage
}) {
  return <div className="page-panel collaboration-page">
    <div className="toolbar"><div><h2>Collab Online</h2><p className="muted">Create or join a room and work together in real time.</p></div>{room && <span className={`collab-status ${collabStatus}`}>{collabStatus === 'online' ? '● Online' : collabStatus}</span>}</div>
    {!room ? <div className="collab-lobby">
      <div className="collab-card"><Users size={32}/><h3>Create a collaboration room</h3><p>Get a unique room ID and shareable link for your team.</p><button className="primary" onClick={createRoom}>Create Room</button></div>
      <div className="collab-or">OR</div>
      <div className="collab-card"><Link2 size={32}/><h3>Join an existing room</h3><p>Enter the room ID shared by another user.</p><div className="join-row"><input value={roomInput} onChange={e => setRoomInput(e.target.value)} placeholder="Room ID e.g. A1B2C3D4" onKeyDown={e => e.key === 'Enter' && joinRoom()}/><button className="primary" onClick={joinRoom}>Join Room</button></div></div>
    </div> : <div className="collab-workspace">
      <section className="collab-room-head">
        <div><span className="eyebrow">ACTIVE ROOM</span><h3>#{room}</h3><p>{roomUsers.length} user{roomUsers.length === 1 ? '' : 's'} online</p></div>
        <div className="room-actions"><button className="secondary" onClick={copyRoomId}><Copy size={16}/> Copy Room ID</button><button className="secondary" onClick={shareRoom}><Link2 size={16}/> Share Link</button><button className="secondary danger-button" onClick={leaveRoom}><LogOut size={16}/> Leave</button></div>
      </section>
      <div className="collab-grid">
        <section className="collab-main-card">
          <div className="collab-section-title"><div><h3>People in this room</h3><p className="muted">Everyone here can receive live collaboration updates.</p></div><span className="live-pill">● LIVE</span></div>
          <div className="user-grid">{roomUsers.map(u => <div className="user-card" key={u.user_id}><div className="user-avatar">{u.user_name?.charAt(0)?.toUpperCase() || '?'}</div><div><b>{u.user_name}{u.user_id === sessionStorage.getItem('ai-smart-notes-participant-id') ? ' (You)' : ''}</b><small><span className="online-dot"/> Online</small></div></div>)}</div>
          <div className="voice-panel">
            <div><h3><Volume2 size={18}/> Voice communication</h3><p className="muted">Talk to everyone in this collaboration room using WebRTC.</p></div>
            <div className="voice-actions"><button className="primary" onClick={toggleVoice}>{voiceEnabled ? <PhoneOff size={17}/> : <Mic size={17}/>} {voiceEnabled ? 'Leave Voice' : 'Join Voice'}</button>{voiceEnabled && <button className="secondary" onClick={toggleMute}>{micMuted ? <Mic size={17}/> : <MicOff size={17}/>} {micMuted ? 'Unmute' : 'Mute'}</button>}</div>
            {voiceEnabled && <div className="voice-note"><ShieldCheck size={15}/> Voice uses browser WebRTC. A public STUN server helps browsers discover a direct connection; no voice API is required.</div>}
            <div className="remote-audio">{Object.entries(remoteStreams).map(([id, stream]) => <RemoteAudio key={id} stream={stream} name={roomUsers.find(u => u.user_id === id)?.user_name || 'User'} />)}</div>
          </div>
          <div className="shared-note-area"><h3>Room discussion</h3><div className="collab-chat">{collabMessages.length ? collabMessages.map((m,i)=><div className="collab-chat-line" key={i}><b>{m.name}</b><span>{m.message}</span></div>) : <p className="muted">Send a message to the other users in this room.</p>}</div><div className="chat-input"><input value={collabMessage} onChange={e => setCollabMessage(e.target.value)} placeholder="Message everyone..." onKeyDown={e => e.key === 'Enter' && sendCollabMessage()}/><button className="primary" onClick={sendCollabMessage}><Send size={17}/></button></div></div>
        </section>
        <aside className="collab-side-card"><h3>Invite others</h3><p>Share this room link so another user can join directly.</p><div className="share-link-box">{PUBLIC_FRONTEND_URL}/collab/{room}</div><button className="primary full-button" onClick={shareRoom}><UserPlus size={17}/> Copy Invite Link</button><div className="how-it-works"><b>How it works</b><ol><li>Create a room or enter a room ID.</li><li>Share the link with your teammates.</li><li>They enter their name and join directly.</li><li>Use Join Voice for live voice communication.</li></ol></div></aside>
      </div>
    </div>}
  </div>;
}

function RemoteAudio({ stream, name }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); } }, [stream]);
  return <div className="remote-user"><Volume2 size={14}/><span>{name}</span><audio ref={ref} autoPlay playsInline /></div>;
}

function languageName(code) { return NOTE_LANGUAGES.find(([v]) => v === code)?.[1] || 'English'; }

function MultimediaCard({ frame }) {
  const a = frame.analysis || {};
  const type = a.type || 'visual';
  const icon = type === 'code' ? <Code2 size={18}/> : type === 'diagram' || type === 'chart' ? <BarChart3 size={18}/> : type === 'slide' ? <FileImage size={18}/> : <ImageIcon size={18}/>;
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const timestamp = formatTimestamp(frame.timestamp);
  const copyCode = async () => { if (a.code) await navigator.clipboard?.writeText(a.code); };
  const jump = () => { alert(`Video timestamp: ${timestamp}\nUse the original video player to jump to ${timestamp}.`); };

  return <article className="visual-card">
    <img src={`${SERVER}${frame.url}`} alt={a.title || `${label} at ${timestamp}`} />
    <div className="visual-card-body">
      <div className="visual-type">{icon}{label}</div>
      <h3>{a.title || 'Detected visual content'}</h3>
      <div className="timestamp">⏱ {timestamp}</div>
      {a.description && <p>{a.description}</p>}
      {a.spoken_context && <div className="spoken"><b>Explanation:</b> {a.spoken_context}</div>}
      {a.extracted_text && <div className="extracted"><b>Visible text</b><p>{a.extracted_text}</p></div>}
      {a.code && <pre className="code-block">{a.code}</pre>}
      <div className="visual-actions">
        {a.code && <button className="secondary" onClick={copyCode}><Copy size={15}/> Copy Code</button>}
        <button className="secondary" onClick={() => window.open(`${SERVER}${frame.url}`, '_blank')}><ExternalLink size={15}/> View Frame</button>
        <button className="secondary" onClick={jump}><Play size={15}/> Timestamp</button>
      </div>
    </div>
  </article>;
}

function formatTimestamp(seconds = 0) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const LABELS = {
  en: { title:'Title', overview:'Overview', main_points:'Main Points', key_insights:'Key Insights', important_details:'Important Details', conclusion:'Conclusion', meeting_title:'Meeting Title', agenda:'Agenda', discussion_points:'Discussion Points', decisions_made:'Decisions Made', action_items:'Action Items', important_follow_ups:'Important Follow-ups', next_meeting:'Next Meeting', subject:'Subject', topic:'Topic', learning_objectives:'Learning Objectives', main_concepts:'Main Concepts', detailed_explanation:'Detailed Explanation', important_definitions:'Important Definitions', examples:'Examples', key_points:'Key Points', quick_revision:'Quick Revision', task_title:'Task Title', description:'Description', tasks:'Tasks', required_actions:'Required Actions', deadlines:'Deadlines', next_steps:'Next Steps' },
  kn: { title:'ಶೀರ್ಷಿಕೆ', overview:'ಅವಲೋಕನ', main_points:'ಮುಖ್ಯ ಅಂಶಗಳು', key_insights:'ಪ್ರಮುಖ ಒಳನೋಟಗಳು', important_details:'ಪ್ರಮುಖ ವಿವರಗಳು', conclusion:'ತೀರ್ಮಾನ', meeting_title:'ಸಭೆಯ ಶೀರ್ಷಿಕೆ', agenda:'ಕಾರ್ಯಸೂಚಿ', discussion_points:'ಚರ್ಚೆಯ ಅಂಶಗಳು', decisions_made:'ತೆಗೆದುಕೊಂಡ ನಿರ್ಧಾರಗಳು', action_items:'ಕಾರ್ಯಗಳು', important_follow_ups:'ಪ್ರಮುಖ ಅನುಸರಣೆಗಳು', next_meeting:'ಮುಂದಿನ ಸಭೆ', subject:'ವಿಷಯ', topic:'ಟಾಪಿಕ್', learning_objectives:'ಕಲಿಕೆಯ ಉದ್ದೇಶಗಳು', main_concepts:'ಮುಖ್ಯ ಪರಿಕಲ್ಪನೆಗಳು', detailed_explanation:'ವಿವರವಾದ ವಿವರಣೆ', important_definitions:'ಪ್ರಮುಖ ವ್ಯಾಖ್ಯಾನಗಳು', examples:'ಉದಾಹರಣೆಗಳು', key_points:'ಮುಖ್ಯ ಅಂಶಗಳು', quick_revision:'ತ್ವರಿತ ಪುನರವಲೋಕನ', task_title:'ಕಾರ್ಯದ ಶೀರ್ಷಿಕೆ', description:'ವಿವರಣೆ', tasks:'ಕಾರ್ಯಗಳು', required_actions:'ಅಗತ್ಯ ಕ್ರಮಗಳು', deadlines:'ಗಡುವುಗಳು', next_steps:'ಮುಂದಿನ ಹಂತಗಳು' },
  hi: { title:'शीर्षक', overview:'अवलोकन', main_points:'मुख्य बिंदु', key_insights:'मुख्य अंतर्दृष्टियाँ', important_details:'महत्वपूर्ण विवरण', conclusion:'निष्कर्ष', meeting_title:'बैठक का शीर्षक', agenda:'कार्यसूची', discussion_points:'चर्चा के बिंदु', decisions_made:'लिए गए निर्णय', action_items:'कार्य', important_follow_ups:'महत्वपूर्ण अनुवर्ती कार्य', next_meeting:'अगली बैठक', subject:'विषय', topic:'विषय', learning_objectives:'सीखने के उद्देश्य', main_concepts:'मुख्य अवधारणाएँ', detailed_explanation:'विस्तृत विवरण', important_definitions:'महत्वपूर्ण परिभाषाएँ', examples:'उदाहरण', key_points:'मुख्य बिंदु', quick_revision:'त्वरित पुनरावृत्ति', task_title:'कार्य शीर्षक', description:'विवरण', tasks:'कार्य', required_actions:'आवश्यक कार्रवाइयाँ', deadlines:'समय-सीमाएँ', next_steps:'अगले चरण' },
  te: { title:'శీర్షిక', overview:'అవలోకనం', main_points:'ప్రధాన అంశాలు', key_insights:'ముఖ్యమైన అవగాహనలు', important_details:'ముఖ్యమైన వివరాలు', conclusion:'ముగింపు', meeting_title:'సమావేశ శీర్షిక', agenda:'కార్యసూచి', discussion_points:'చర్చా అంశాలు', decisions_made:'తీసుకున్న నిర్ణయాలు', action_items:'చర్యలు', important_follow_ups:'ముఖ్యమైన అనుసరణలు', next_meeting:'తదుపరి సమావేశం', subject:'విషయం', topic:'అంశం', learning_objectives:'అభ్యాస లక్ష్యాలు', main_concepts:'ప్రధాన భావనలు', detailed_explanation:'వివరణాత్మక వివరణ', important_definitions:'ముఖ్యమైన నిర్వచనాలు', examples:'ఉదాహరణలు', key_points:'ముఖ్య అంశాలు', quick_revision:'త్వరిత పునశ్చరణ', task_title:'పని శీర్షిక', description:'వివరణ', tasks:'పనులు', required_actions:'అవసరమైన చర్యలు', deadlines:'గడువులు', next_steps:'తదుపరి దశలు' },
  ta: { title:'தலைப்பு', overview:'மேலோட்டம்', main_points:'முக்கிய அம்சங்கள்', key_insights:'முக்கிய நுண்ணறிவுகள்', important_details:'முக்கிய விவரங்கள்', conclusion:'முடிவு', meeting_title:'கூட்டத் தலைப்பு', agenda:'நிகழ்ச்சி நிரல்', discussion_points:'விவாத அம்சங்கள்', decisions_made:'எடுக்கப்பட்ட முடிவுகள்', action_items:'செயல்கள்', important_follow_ups:'முக்கிய தொடர்ச்சிகள்', next_meeting:'அடுத்த கூட்டம்', subject:'பாடம்', topic:'தலைப்பு', learning_objectives:'கற்றல் நோக்கங்கள்', main_concepts:'முக்கிய கருத்துகள்', detailed_explanation:'விரிவான விளக்கம்', important_definitions:'முக்கிய வரையறைகள்', examples:'எடுத்துக்காட்டுகள்', key_points:'முக்கிய குறிப்புகள்', quick_revision:'விரைவு மறுபரிசீலனை', task_title:'பணி தலைப்பு', description:'விளக்கம்', tasks:'பணிகள்', required_actions:'தேவையான செயல்கள்', deadlines:'காலக்கெடுகள்', next_steps:'அடுத்த படிகள்' },
  ml: { title:'ശീർഷകം', overview:'അവലോകനം', main_points:'പ്രധാന പോയിന്റുകൾ', key_insights:'പ്രധാന ഉൾക്കാഴ്ചകൾ', important_details:'പ്രധാന വിശദാംശങ്ങൾ', conclusion:'ഉപസംഹാരം', meeting_title:'യോഗത്തിന്റെ ശീർഷകം', agenda:'അജണ്ട', discussion_points:'ചർച്ചാ വിഷയങ്ങൾ', decisions_made:'എടുത്ത തീരുമാനങ്ങൾ', action_items:'പ്രവർത്തനങ്ങൾ', important_follow_ups:'പ്രധാന തുടർനടപടികൾ', next_meeting:'അടുത്ത യോഗം', subject:'വിഷയം', topic:'വിഷയം', learning_objectives:'പഠന ലക്ഷ്യങ്ങൾ', main_concepts:'പ്രധാന ആശയങ്ങൾ', detailed_explanation:'വിശദീകരണം', important_definitions:'പ്രധാന നിർവചനങ്ങൾ', examples:'ഉദാഹരണങ്ങൾ', key_points:'പ്രധാന പോയിന്റുകൾ', quick_revision:'ദ്രുത പുനഃപരിശോധന', task_title:'ടാസ്ക് ശീർഷകം', description:'വിവരണം', tasks:'ടാസ്കുകൾ', required_actions:'ആവശ്യമായ പ്രവർത്തനങ്ങൾ', deadlines:'അവസാന തീയതികൾ', next_steps:'അടുത്ത ഘട്ടങ്ങൾ' }
};

function NoteView({ note, type, labels: backendLabels }) {
  const currentLanguage = note?._language || 'en';
  const labels = backendLabels && Object.keys(backendLabels).length ? backendLabels : (LABELS[currentLanguage] || LABELS.en);
  const typeLabels = { en:{summary:'Summary',meeting:'Meeting',lecture:'Lecture',task:'Task'}, kn:{summary:'ಸಾರಾಂಶ',meeting:'ಸಭೆ',lecture:'ಉಪನ್ಯಾಸ',task:'ಕಾರ್ಯ'}, hi:{summary:'सारांश',meeting:'बैठक',lecture:'व्याख्यान',task:'कार्य'}, te:{summary:'సారాంశం',meeting:'సమావేశం',lecture:'ఉపన్యాసం',task:'పని'}, ta:{summary:'சுருக்கம்',meeting:'கூட்டம்',lecture:'விரிவுரை',task:'பணி'}, ml:{summary:'സംഗ്രഹം',meeting:'യോഗം',lecture:'പ്രഭാഷണം',task:'ടാസ്ക്'} };
  return <div className="generated"><div className="note-badge">{(typeLabels[currentLanguage] || typeLabels.en)[type] || TYPES[type]?.label || type}</div>{Object.entries(note || {}).filter(([k]) => k !== '_language').map(([k, v]) => <section key={k}><h3>{labels[k] || k.replaceAll('_', ' ')}</h3>{Array.isArray(v) ? <ul>{v.map((x, i) => <li key={i}>{typeof x === 'object' ? <StructuredObject value={x} labels={labels}/> : x}</li>)}</ul> : <p>{typeof v === 'object' ? <StructuredObject value={v} labels={labels}/> : v}</p>}</section>)}</div>;
}

function StructuredObject({ value, labels = LABELS.en }) { return <div className="structured-object">{Object.entries(value || {}).map(([k, v]) => <div key={k}><b>{labels[k] || k.replaceAll('_', ' ')}:</b> {Array.isArray(v) ? v.join(', ') : String(v ?? '')}</div>)}</div>; }
function Empty({ text }) { return <div className="empty"><FileText size={40}/><p>{text}</p></div>; }

createRoot(document.getElementById('root')).render(<App/>);
