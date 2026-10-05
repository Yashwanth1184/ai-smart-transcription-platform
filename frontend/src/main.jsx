import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_URL || "https://ai-smart-transcription-platform.onrender.com/api";

function App() {
  const [activeTab, setActiveTab] = useState("Home");
  const [file, setFile] = useState(null);
  const [media, setMedia] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptionLang, setTranscriptionLang] = useState("auto");
  const [noteLanguage, setNoteLanguage] = useState("en");
  const [noteType, setNoteType] = useState("summary");
  const [currentNote, setCurrentNote] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [frames, setFrames] = useState([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    fetchNotes();
    fetchTasks();
  }, []);

  async function fetchNotes() {
    try {
      const res = await fetch(`${API_BASE}/notes`);
      if (res.ok) {
        const data = await res.json();
        setAllNotes(data);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchTasks() {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function uploadAndTranscribe() {
    if (!file) {
      setErrorMsg("Please select an audio or video file first.");
      return;
    }
    setErrorMsg("");
    setLoadingMsg("Uploading media file...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const upRes = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!upRes.ok) {
        const err = await upRes.json();
        throw new Error(err.detail || "Upload failed");
      }

      const mediaData = await upRes.json();
      setMedia(mediaData);

      setLoadingMsg("Transcribing audio content using Gemini API...");
      const transRes = await fetch(
        `${API_BASE}/transcribe/${mediaData.id}?language=${transcriptionLang}`,
        { method: "POST" }
      );

      if (!transRes.ok) {
        const err = await transRes.json();
        throw new Error(err.detail || "Transcription failed");
      }

      const transData = await transRes.json();
      setTranscript(transData.text || "");

      if (mediaData.media_type === "video") {
        setLoadingMsg("Extracting and analyzing visual frames...");
        fetch(`${API_BASE}/media/extract-frames/${mediaData.id}`, { method: "POST" })
          .then((r) => r.json())
          .then((fData) => {
            if (fData.frames) setFrames(fData.frames);
          })
          .catch(console.error);
      }

      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Failed to process audio.");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const recordedFile = new File([audioBlob], "recorded_audio.webm", {
          type: "audio/webm",
        });
        setFile(recordedFile);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      setErrorMsg("Microphone permission denied or unsupported.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  async function generate() {
    if (!transcript.trim()) {
      setErrorMsg("Valid transcript is required before generating notes.");
      return;
    }
    setErrorMsg("");
    setLoadingMsg(`Generating ${noteType} notes...`);

    try {
      const res = await fetch(`${API_BASE}/generate-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_id: media ? media.id : null,
          note_type: noteType,
          note_language: noteLanguage,
          transcript: transcript.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Note generation failed");
      }

      const note = await res.json();
      setCurrentNote(note);
      fetchNotes();
      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Failed to generate notes.");
    }
  }

  async function handleExtractTasks() {
    if (!media) {
      setErrorMsg("Please upload and transcribe a file first.");
      return;
    }
    setErrorMsg("");
    setLoadingMsg("Extracting actionable tasks...");

    try {
      const res = await fetch(`${API_BASE}/tasks/extract/${media.id}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Extraction failed");
      }
      await fetchTasks();
      setActiveTab("Tasks & Reminders");
      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Failed to extract tasks.");
    }
  }

  async function handleChat(e) {
    e.preventDefault();
    if (!chatQuestion.trim() || !currentNote) return;

    const userQ = chatQuestion;
    setChatQuestion("");
    setChatHistory((prev) => [...prev, { sender: "user", text: userQ }]);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note_id: currentNote.id,
          question: userQ,
        }),
      });

      if (!res.ok) throw new Error("Chat failed");
      const data = await res.json();
      setChatHistory((prev) => [...prev, { sender: "ai", text: data.answer }]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { sender: "ai", text: "Error fetching answer. Please try again." },
      ]);
    }
  }

  function renderNoteDetails(content) {
    if (!content) return null;
    return (
      <div className="note-content-display">
        {Object.entries(content).map(([key, val]) => {
          const title = key.replace(/_/g, " ").toUpperCase();
          if (Array.isArray(val)) {
            return (
              <div key={key} className="note-section">
                <h4>{title}</h4>
                <ul>
                  {val.map((item, idx) => (
                    <li key={idx}>
                      {typeof item === "object" ? JSON.stringify(item) : item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return (
            <div key={key} className="note-section">
              <h4>{title}</h4>
              <p>{typeof val === "object" ? JSON.stringify(val) : val}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="logo-section">
          <h2>🎙 AI Smart Notes</h2>
        </div>
        <nav className="nav-menu">
          {[
            { id: "Home", icon: "🏠", label: "Home" },
            { id: "Transcribe", icon: "⬆️", label: "Transcribe" },
            { id: "My Notes", icon: "📑", label: "My Notes" },
            { id: "Chat with Notes", icon: "💬", label: "Chat with Notes" },
            { id: "Tasks & Reminders", icon: "☑️", label: "Tasks & Reminders" },
            { id: "Multimedia", icon: "🖼️", label: "Multimedia" },
            { id: "Export", icon: "📥", label: "Export" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <h1>Transform Audio & Video into Smart Notes</h1>
          <p>Transcribe, understand, organize and act on your content using AI.</p>
        </header>

        {errorMsg && (
          <div className="alert-banner error">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg("")}>×</button>
          </div>
        )}

        {loadingMsg && (
          <div className="alert-banner info">
            <span>⏳ {loadingMsg}</span>
          </div>
        )}

        {activeTab === "Home" || activeTab === "Transcribe" ? (
          <div className="transcription-workspace">
            <div className="note-type-cards">
              {[
                { id: "summary", title: "Summary", desc: "General overview with key insights" },
                { id: "meeting", title: "Meeting", desc: "Decisions, discussions and action items" },
                { id: "lecture", title: "Lecture", desc: "Concepts, explanations and revision" },
                { id: "task", title: "Task", desc: "Tasks, priorities and deadlines" },
              ].map((card) => (
                <div
                  key={card.id}
                  className={`type-card ${noteType === card.id ? "active" : ""}`}
                  onClick={() => setNoteType(card.id)}
                >
                  <div className="type-icon">📑</div>
                  <h3>{card.title}</h3>
                  <p>{card.desc}</p>
                </div>
              ))}
            </div>

            <div className="workspace-columns">
              <div className="panel upload-panel">
                <div className="dropzone-box">
                  <div className="upload-icon">⬆️</div>
                  <h3>Upload Audio or Video</h3>
                  <p>MP3, WAV, M4A, MP4, MOV, WEBM</p>
                  <input
                    type="file"
                    id="mediaInput"
                    accept="audio/*,video/*"
                    onChange={(e) => setFile(e.target.files[0])}
                  />
                  <label htmlFor="mediaInput" className="file-select-btn">
                    {file ? file.name : "Choose File"}
                  </label>
                </div>

                <div className="form-group">
                  <label>Transcription Language</label>
                  <select
                    value={transcriptionLang}
                    onChange={(e) => setTranscriptionLang(e.target.value)}
                  >
                    <option value="auto">Auto detect</option>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="hi">Hindi</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Note Language</label>
                  <select
                    value={noteLanguage}
                    onChange={(e) => setNoteLanguage(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="hi">Hindi</option>
                  </select>
                </div>

                <div className="button-group">
                  <button
                    className={`btn-secondary ${isRecording ? "recording" : ""}`}
                    onClick={isRecording ? stopRecording : startRecording}
                  >
                    {isRecording ? "⏹️ Stop Recording" : "⏺️ Record Audio"}
                  </button>
                  <button className="btn-primary" onClick={uploadAndTranscribe}>
                    ▶️ Upload & Transcribe
                  </button>
                </div>
              </div>

              <div className="panel transcript-panel">
                <div className="panel-header">
                  <h3>Transcript</h3>
                  <span className="badge">{noteType} mode</span>
                </div>
                <textarea
                  className="transcript-textarea"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Your transcript will appear here after transcription. You can also paste transcript text for testing."
                />

                <div className="action-footer">
                  <button className="btn-primary" onClick={generate}>
                    Generate {noteType.charAt(0).toUpperCase() + noteType.slice(1)} Notes
                  </button>
                  <button className="btn-outline" onClick={handleExtractTasks}>
                    Extract Action Items
                  </button>
                </div>

                {frames.length > 0 && (
                  <p className="frame-hint">
                    🖼️ {frames.length} visual items detected. Open Multimedia to view them.
                  </p>
                )}
              </div>
            </div>

            {currentNote && (
              <div className="note-display-card">
                <h2>{currentNote.title}</h2>
                {renderNoteDetails(currentNote.content)}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "My Notes" && (
          <div className="notes-list-view">
            <h2>Your Saved Notes</h2>
            <div className="notes-grid">
              {allNotes.map((n) => (
                <div
                  key={n.id}
                  className="note-summary-card"
                  onClick={() => {
                    setCurrentNote(n);
                    setActiveTab("Home");
                  }}
                >
                  <div className="badge">{n.note_type}</div>
                  <h3>{n.title}</h3>
                  <p>{n.created_at ? new Date(n.created_at).toLocaleDateString() : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "Chat with Notes" && (
          <div className="chat-container">
            <h2>Chat with Notes</h2>
            {!currentNote ? (
              <p>Please generate or select a note to start asking questions.</p>
            ) : (
              <>
                <div className="chat-log">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`chat-message ${msg.sender}`}>
                      <b>{msg.sender === "user" ? "You" : "AI"}:</b> {msg.text}
                    </div>
                  ))}
                </div>
                <form className="chat-form" onSubmit={handleChat}>
                  <input
                    type="text"
                    placeholder="Ask a question about your notes..."
                    value={chatQuestion}
                    onChange={(e) => setChatQuestion(e.target.value)}
                  />
                  <button type="submit" className="btn-primary">Send</button>
                </form>
              </>
            )}
          </div>
        )}

        {activeTab === "Tasks & Reminders" && (
          <div className="tasks-container">
            <h2>Action Items & Commitments</h2>
            <div className="task-list">
              {tasks.length === 0 ? (
                <p>No extracted tasks found.</p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="task-row">
                    <div>
                      <h4>{t.title}</h4>
                      <p>{t.description}</p>
                    </div>
                    <span className={`priority-tag ${t.priority.toLowerCase()}`}>
                      {t.priority}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "Multimedia" && (
          <div className="multimedia-container">
            <h2>Visual Keyframe Detections</h2>
            <div className="frames-grid">
              {frames.length === 0 ? (
                <p>No video keyframes extracted yet.</p>
              ) : (
                frames.map((f, i) => (
                  <div key={i} className="frame-card">
                    <h4>{f.analysis?.title || f.filename}</h4>
                    <p>{f.analysis?.description}</p>
                    {f.analysis?.extracted_text && (
                      <pre>{f.analysis.extracted_text}</pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "Export" && (
          <div className="export-container">
            <h2>Export Note</h2>
            {!currentNote ? (
              <p>Please select or generate a note first.</p>
            ) : (
              <div className="export-buttons">
                {["pdf", "docx", "txt", "json"].map((fmt) => (
                  <a
                    key={fmt}
                    className="btn-primary"
                    href={`${API_BASE}/export/${currentNote.id}/${fmt}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download as {fmt.toUpperCase()}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);