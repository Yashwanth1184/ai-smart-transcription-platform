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

      setLoadingMsg("Transcribing audio content with Gemini AI...");
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
        setLoadingMsg("Extracting video keyframes...");
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
    if (!transcript.trim()) {
      setErrorMsg("Please upload and transcribe a file first.");
      return;
    }
    setErrorMsg("");
    setLoadingMsg("Extracting actionable tasks...");

    try {
      const res = await fetch(`${API_BASE}/tasks/extract/${media ? media.id : 1}`, { method: "POST" });
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
      <div className="note-rendered-box">
        {Object.entries(content).map(([key, val]) => {
          const title = key.replace(/_/g, " ").toUpperCase();
          if (Array.isArray(val)) {
            return (
              <div key={key} className="note-block">
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
            <div key={key} className="note-block">
              <h4>{title}</h4>
              <p>{typeof val === "object" ? JSON.stringify(val) : val}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="side-nav">
        <div className="brand">
          <span className="brand-icon">🎙️</span>
          <h2>AI Smart Notes</h2>
        </div>
        <div className="nav-list">
          {[
            { id: "Home", icon: "🏠", label: "Home" },
            { id: "Transcribe", icon: "⬆️️", label: "Transcribe" },
            { id: "My Notes", icon: "📑", label: "My Notes" },
            { id: "Chat with Notes", icon: "💬", label: "Chat with Notes" },
            { id: "Tasks & Reminders", icon: "☑️", label: "Tasks & Reminders" },
            { id: "Multimedia", icon: "🖼️", label: "Multimedia" },
            { id: "Export", icon: "📥", label: "Export" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nav-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Layout Area */}
      <div className="main-layout">
        <header className="hero-section">
          <h1>Transform Audio &amp; Video into Smart Notes</h1>
          <p>Transcribe, understand, organize and act on your content using AI.</p>
        </header>

        {/* Global Notifications */}
        {errorMsg && (
          <div className="banner error-banner">
            <span>{errorMsg}</span>
            <button className="close-btn" onClick={() => setErrorMsg("")}>×</button>
          </div>
        )}

        {loadingMsg && (
          <div className="banner info-banner">
            <span>⏳ {loadingMsg}</span>
          </div>
        )}

        {/* Home & Transcribe Views */}
        {(activeTab === "Home" || activeTab === "Transcribe") && (
          <div className="view-content">
            {/* Note Type Pill Selectors */}
            <div className="type-pills-row">
              {[
                { id: "summary", title: "Summary", desc: "General overview with key insights" },
                { id: "meeting", title: "Meeting", desc: "Decisions, discussions and action items" },
                { id: "lecture", title: "Lecture", desc: "Concepts, explanations and revision" },
                { id: "task", title: "Task", desc: "Tasks, priorities and deadlines" },
              ].map((card) => (
                <div
                  key={card.id}
                  className={`type-pill ${noteType === card.id ? "active" : ""}`}
                  onClick={() => setNoteType(card.id)}
                >
                  <div className="pill-header">
                    <span className="pill-icon">📄</span>
                    <h4>{card.title}</h4>
                  </div>
                  <p>{card.desc}</p>
                </div>
              ))}
            </div>

            {/* Split Grid */}
            <div className="content-grid">
              {/* Upload Card */}
              <div className="glass-card upload-card">
                <div className="dropzone-area">
                  <span className="drop-icon">⬆️</span>
                  <h3>Upload Audio or Video</h3>
                  <p>MP3, WAV, M4A, MP4, MOV, WEBM</p>
                  <input
                    type="file"
                    id="mediaUploadInput"
                    accept="audio/*,video/*"
                    onChange={(e) => setFile(e.target.files[0])}
                  />
                  <label htmlFor="mediaUploadInput" className="primary-action-btn">
                    {file ? file.name : "Choose File"}
                  </label>
                </div>

                <div className="controls-row">
                  <div className="field-group">
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

                  <div className="field-group">
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
                </div>

                <div className="actions-cluster">
                  <button
                    className={`secondary-btn ${isRecording ? "recording-pulse" : ""}`}
                    onClick={isRecording ? stopRecording : startRecording}
                  >
                    {isRecording ? "⏹️ Stop Recording" : "⏺️ Record Audio"}
                  </button>
                  <button className="primary-btn" onClick={uploadAndTranscribe}>
                    ▶️ Upload &amp; Transcribe
                  </button>
                </div>
              </div>

              {/* Transcript Card */}
              <div className="glass-card transcript-card">
                <div className="card-top">
                  <h3>Transcript</h3>
                  <span className="mode-badge">{noteType.toUpperCase()} mode</span>
                </div>
                <textarea
                  className="input-area"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Your transcript will appear here after transcription. You can also paste transcript text for testing."
                />

                <div className="footer-actions">
                  <button className="primary-btn" onClick={generate}>
                    Generate {noteType.charAt(0).toUpperCase() + noteType.slice(1)} Notes
                  </button>
                  <button className="outline-btn" onClick={handleExtractTasks}>
                    Extract Action Items
                  </button>
                </div>

                {frames.length > 0 && (
                  <div className="meta-footer">
                    🖼️ {frames.length} visual items detected. Open Multimedia to view them.
                  </div>
                )}
              </div>
            </div>

            {/* Note Display Box */}
            {currentNote && (
              <div className="glass-card result-note-box">
                <h2>{currentNote.title}</h2>
                {renderNoteDetails(currentNote.content)}
              </div>
            )}
          </div>
        )}

        {/* My Notes View */}
        {activeTab === "My Notes" && (
          <div className="view-content">
            <h2>Your Saved Notes</h2>
            <div className="notes-masonry">
              {allNotes.map((n) => (
                <div
                  key={n.id}
                  className="glass-card note-card-preview"
                  onClick={() => {
                    setCurrentNote(n);
                    setActiveTab("Home");
                  }}
                >
                  <span className="mode-badge">{n.note_type}</span>
                  <h3>{n.title}</h3>
                  <small>{n.created_at ? new Date(n.created_at).toLocaleDateString() : ""}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat with Notes View */}
        {activeTab === "Chat with Notes" && (
          <div className="view-content">
            <h2>Chat with Notes</h2>
            {!currentNote ? (
              <div className="glass-card placeholder-card">
                <p>Please generate or select a note from "My Notes" to start asking questions.</p>
              </div>
            ) : (
              <div className="glass-card chat-card">
                <div className="chat-thread">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`bubble ${msg.sender}`}>
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
                  <button type="submit" className="primary-btn">Send</button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* Tasks & Reminders View */}
        {activeTab === "Tasks & Reminders" && (
          <div className="view-content">
            <h2>Action Items &amp; Commitments</h2>
            <div className="glass-card tasks-wrapper">
              {tasks.length === 0 ? (
                <p>No extracted tasks found. Click "Extract Action Items" in the transcript view.</p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="task-item">
                    <div className="task-info">
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

        {/* Multimedia Frames View */}
        {activeTab === "Multimedia" && (
          <div className="view-content">
            <h2>Visual Keyframe Detections</h2>
            <div className="frames-masonry">
              {frames.length === 0 ? (
                <div className="glass-card placeholder-card">
                  <p>No video keyframes extracted yet. Upload a video file on Home.</p>
                </div>
              ) : (
                frames.map((f, i) => (
                  <div key={i} className="glass-card frame-card">
                    <h4>{f.analysis?.title || f.filename}</h4>
                    <p>{f.analysis?.description}</p>
                    {f.analysis?.extracted_text && (
                      <pre className="code-snippet">{f.analysis.extracted_text}</pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Export View */}
        {activeTab === "Export" && (
          <div className="view-content">
            <h2>Export Note</h2>
            {!currentNote ? (
              <div className="glass-card placeholder-card">
                <p>Please generate or select a note first.</p>
              </div>
            ) : (
              <div className="glass-card export-box">
                <p>Download <b>{currentNote.title}</b> in your preferred format:</p>
                <div className="export-grid">
                  {["pdf", "docx", "txt", "json"].map((fmt) => (
                    <a
                      key={fmt}
                      className="primary-btn"
                      href={`${API_BASE}/export/${currentNote.id}/${fmt}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download {fmt.toUpperCase()}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);