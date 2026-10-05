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
      <div className="space-y-4">
        {Object.entries(content).map(([key, val]) => {
          const title = key.replace(/_/g, " ").toUpperCase();
          if (Array.isArray(val)) {
            return (
              <div key={key} className="bg-slate-900/60 p-4 rounded-xl border border-white/10">
                <h4 className="text-sm font-semibold tracking-wider text-rose-400 mb-2">{title}</h4>
                <ul className="list-disc list-inside space-y-1 text-slate-200">
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
            <div key={key} className="bg-slate-900/60 p-4 rounded-xl border border-white/10">
              <h4 className="text-sm font-semibold tracking-wider text-rose-400 mb-2">{title}</h4>
              <p className="text-slate-200 whitespace-pre-wrap">{typeof val === "object" ? JSON.stringify(val) : val}</p>
            </div>
          );
        })}
      </div>
    );
  }

  const navItems = [
    { id: "Home", label: "Home", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "Transcribe", label: "Transcribe", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
    { id: "My Notes", label: "My Notes", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { id: "Chat with Notes", label: "Chat with Notes", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
    { id: "Tasks & Reminders", label: "Tasks & Reminders", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
    { id: "Multimedia", label: "Multimedia", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "Export", label: "Export", icon: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/80 backdrop-blur-md border-r border-white/10 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-6 flex items-center space-x-3 border-b border-white/10">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-rose-500/20">
              🎙️
            </div>
            <div>
              <h2 className="font-bold text-lg leading-none tracking-tight">AI Smart Notes</h2>
              <p className="text-xs text-slate-400 mt-1">Platform v1.0</p>
            </div>
          </div>
          <nav className="p-4 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === item.id
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-rose-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
              Transform Audio &amp; Video into Smart Notes
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Transcribe, understand, organize and act on your content using AI.
            </p>
          </div>
          <div className="h-10 w-10 rounded-full bg-rose-600 flex items-center justify-center font-bold text-white shadow">
            U
          </div>
        </header>

        {/* Global Notifications */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-200 flex justify-between items-center shadow-lg">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg("")} className="font-bold hover:text-white text-lg">×</button>
          </div>
        )}

        {loadingMsg && (
          <div className="mb-6 p-4 rounded-xl bg-amber-950/70 border border-amber-500/50 text-amber-200 flex items-center space-x-3 shadow-lg">
            <span className="animate-spin text-xl">⏳</span>
            <span>{loadingMsg}</span>
          </div>
        )}

        {/* Home & Transcribe View */}
        {(activeTab === "Home" || activeTab === "Transcribe") && (
          <div className="space-y-6">
            {/* Note Type Cards */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { id: "summary", title: "Summary", desc: "General overview with key insights" },
                { id: "meeting", title: "Meeting", desc: "Decisions, discussions and action items" },
                { id: "lecture", title: "Lecture", desc: "Concepts, explanations and revision" },
                { id: "task", title: "Task", desc: "Tasks, priorities and deadlines" },
              ].map((card) => (
                <div
                  key={card.id}
                  onClick={() => setNoteType(card.id)}
                  className={`p-4 rounded-2xl cursor-pointer border transition-all ${
                    noteType === card.id
                      ? "bg-gradient-to-b from-rose-950/60 to-slate-900 border-rose-500/50 shadow-md shadow-rose-950/50"
                      : "bg-slate-900/50 border-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="text-xl mb-2">📑</div>
                  <h3 className="font-bold text-slate-100">{card.title}</h3>
                  <p className="text-xs text-slate-400 mt-1">{card.desc}</p>
                </div>
              ))}
            </div>

            {/* Split Workspace */}
            <div className="grid grid-cols-2 gap-6">
              {/* Upload Card */}
              <div className="bg-slate-900/60 backdrop-blur-md p-6 rounded-2xl border border-white/10 space-y-4 flex flex-col justify-between">
                <div>
                  <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-rose-500/40 transition">
                    <div className="text-3xl mb-2">⬆️</div>
                    <h3 className="font-semibold text-slate-200">Upload Audio or Video</h3>
                    <p className="text-xs text-slate-500 mt-1">MP3, WAV, M4A, MP4, MOV, WEBM</p>
                    <input
                      type="file"
                      id="fileUpload"
                      className="hidden"
                      accept="audio/*,video/*"
                      onChange={(e) => setFile(e.target.files[0])}
                    />
                    <label
                      htmlFor="fileUpload"
                      className="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg cursor-pointer border border-white/10 transition"
                    >
                      {file ? file.name : "Choose File"}
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="text-xs text-slate-400 font-medium block mb-1">Transcription Language</label>
                      <select
                        value={transcriptionLang}
                        onChange={(e) => setTranscriptionLang(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-rose-500/50"
                      >
                        <option value="auto">Auto detect</option>
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                        <option value="hi">Hindi</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 font-medium block mb-1">Note Language</label>
                      <select
                        value={noteLanguage}
                        onChange={(e) => setNoteLanguage(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-rose-500/50"
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                        <option value="hi">Hindi</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3 pt-4 border-t border-white/10">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                      isRecording
                        ? "bg-rose-600 text-white border-rose-400 animate-pulse"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-white/10"
                    }`}
                  >
                    {isRecording ? "⏹️ Stop Recording" : "⏺️ Record Audio"}
                  </button>
                  <button
                    onClick={uploadAndTranscribe}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-500/20 hover:opacity-95 transition"
                  >
                    ▶️ Upload &amp; Transcribe
                  </button>
                </div>
              </div>

              {/* Transcript Card */}
              <div className="bg-slate-900/60 backdrop-blur-md p-6 rounded-2xl border border-white/10 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-slate-200">Transcript</h3>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider">
                      {noteType} mode
                    </span>
                  </div>
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Your transcript will appear here after transcription. You can also paste transcript text for testing."
                    className="w-full h-56 bg-slate-950/80 border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500/50 resize-none font-mono"
                  />
                </div>

                <div className="pt-4 border-t border-white/10 space-y-3">
                  <div className="flex space-x-3">
                    <button
                      onClick={generate}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-500/20 hover:opacity-95 transition"
                    >
                      Generate {noteType.charAt(0).toUpperCase() + noteType.slice(1)} Notes
                    </button>
                    <button
                      onClick={handleExtractTasks}
                      className="py-2.5 px-4 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition"
                    >
                      Extract Action Items
                    </button>
                  </div>
                  {frames.length > 0 && (
                    <p className="text-xs text-slate-400">
                      🖼️ {frames.length} visual items detected. Open Multimedia tab to inspect.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Generated Notes Display */}
            {currentNote && (
              <div className="bg-slate-900/60 backdrop-blur-md p-6 rounded-2xl border border-white/10 mt-6">
                <h2 className="text-2xl font-bold text-slate-100 mb-4">{currentNote.title}</h2>
                {renderNoteDetails(currentNote.content)}
              </div>
            )}
          </div>
        )}

        {/* My Notes View */}
        {activeTab === "My Notes" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-100">Saved Notes</h2>
            <div className="grid grid-cols-3 gap-4">
              {allNotes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    setCurrentNote(n);
                    setActiveTab("Home");
                  }}
                  className="bg-slate-900/60 p-5 rounded-2xl border border-white/10 hover:border-rose-500/40 cursor-pointer transition space-y-2"
                >
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300">
                    {n.note_type}
                  </span>
                  <h3 className="font-bold text-slate-200 line-clamp-1">{n.title}</h3>
                  <p className="text-xs text-slate-500">{n.created_at ? new Date(n.created_at).toLocaleDateString() : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat with Notes View */}
        {activeTab === "Chat with Notes" && (
          <div className="bg-slate-900/60 p-6 rounded-2xl border border-white/10 h-[calc(100vh-12rem)] flex flex-col justify-between">
            <div className="overflow-y-auto space-y-4 pr-2">
              {!currentNote ? (
                <p className="text-sm text-slate-500">Please generate or select a note from "My Notes" first to chat.</p>
              ) : (
                chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-xl p-3.5 rounded-2xl text-sm ${
                      msg.sender === "user" ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-200 border border-white/10"
                    }`}>
                      <b>{msg.sender === "user" ? "You: " : "AI: "}</b>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleChat} className="flex space-x-3 pt-4 border-t border-white/10">
              <input
                type="text"
                placeholder="Ask questions about your notes..."
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-rose-500/50"
              />
              <button type="submit" className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition">
                Send
              </button>
            </form>
          </div>
        )}

        {/* Tasks & Reminders View */}
        {activeTab === "Tasks & Reminders" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-100">Action Items &amp; Commitments</h2>
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-500">No action items extracted yet. Run "Extract Action Items" in the transcript tab.</p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="bg-slate-900/60 p-4 rounded-xl border border-white/10 flex justify-between items-center">
                    <div>
                      <h4 className="font-semibold text-slate-200">{t.title}</h4>
                      <p className="text-xs text-slate-400 mt-1">{t.description}</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
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
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-100">Visual Keyframe Detections</h2>
            <div className="grid grid-cols-2 gap-4">
              {frames.length === 0 ? (
                <p className="text-sm text-slate-500">No video keyframes detected yet.</p>
              ) : (
                frames.map((f, i) => (
                  <div key={i} className="bg-slate-900/60 p-4 rounded-xl border border-white/10 space-y-2">
                    <h4 className="font-semibold text-slate-200">{f.analysis?.title || f.filename}</h4>
                    <p className="text-xs text-slate-400">{f.analysis?.description}</p>
                    {f.analysis?.extracted_text && (
                      <pre className="text-xs bg-slate-950 p-2.5 rounded-lg border border-white/10 overflow-x-auto text-amber-200/90 font-mono">
                        {f.analysis.extracted_text}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Export View */}
        {activeTab === "Export" && (
          <div className="bg-slate-900/60 p-6 rounded-2xl border border-white/10 space-y-4">
            <h2 className="text-2xl font-bold text-slate-100">Export Note</h2>
            {!currentNote ? (
              <p className="text-sm text-slate-500">Please generate or select a note first to enable downloads.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-300">Choose export format for <b>{currentNote.title}</b>:</p>
                <div className="flex space-x-3">
                  {["pdf", "docx", "txt", "json"].map((fmt) => (
                    <a
                      key={fmt}
                      href={`${API_BASE}/export/${currentNote.id}/${fmt}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-semibold border border-white/10 uppercase transition"
                    >
                      {fmt}
                    </a>
                  ))}
                </div>
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