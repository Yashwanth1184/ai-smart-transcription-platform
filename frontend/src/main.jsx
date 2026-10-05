import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const API_BASE = "https://ai-smart-transcription-platform.onrender.com/api";

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

  // =========================================================
  // USERNAME
  // =========================================================
  // The name is stored ONLY in React state.
  // It is NOT stored in localStorage, sessionStorage or cookies.
  const [userName, setUserName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(true);

  // Room Collaboration State
  const [roomId, setRoomId] = useState("");
  const [connectedRoom, setConnectedRoom] = useState("");
  const [roomUsers, setRoomUsers] = useState([]);
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomInput, setRoomInput] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);

  const wsRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnections = useRef({});

  useEffect(() => {
    fetchNotes();
    fetchTasks();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      Object.values(peerConnections.current).forEach((pc) => {
        try {
          pc.close();
        } catch (e) {
          console.error(e);
        }
      });
    };
  }, []);

  // =========================================================
  // USERNAME SUBMIT
  // =========================================================

  function handleNameSubmit() {
    const name = userName.trim();

    if (!name) {
      return;
    }

    setUserName(name);
    setShowNamePrompt(false);
  }

  // =========================================================
  // API HELPERS
  // =========================================================

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

  // =========================================================
  // UPLOAD
  // =========================================================

  async function upload() {
    if (!file) {
      setErrorMsg("Please choose an audio or video file first.");
      return null;
    }

    setErrorMsg("");
    setLoadingMsg("Uploading file...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let err = {};

        try {
          err = await res.json();
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(err.detail || "Upload failed");
      }

      const data = await res.json();

      setMedia(data);
      setLoadingMsg("");

      return data;
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Upload failed.");
      return null;
    }
  }

  // =========================================================
  // TRANSCRIPTION
  // =========================================================

  async function transcribe(mediaToTranscribe = media) {
    if (!mediaToTranscribe) {
      setErrorMsg("Please upload a file first.");
      return;
    }

    setErrorMsg("");
    setLoadingMsg("Transcribing audio...");

    try {
      const languageQuery =
        transcriptionLang === "auto"
          ? ""
          : `?language=${transcriptionLang}`;

      const res = await fetch(
        `${API_BASE}/transcribe/${mediaToTranscribe.id}${languageQuery}`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        let err = {};

        try {
          err = await res.json();
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(err.detail || "Transcription failed");
      }

      const data = await res.json();

      setTranscript(data.text || "");

      // Automatic visual frame extraction for video
      if (mediaToTranscribe.media_type === "video") {
        setLoadingMsg("Extracting visual content from video...");

        try {
          const fRes = await fetch(
            `${API_BASE}/media/extract-frames/${mediaToTranscribe.id}`,
            {
              method: "POST",
            }
          );

          if (fRes.ok) {
            const fData = await fRes.json();
            setFrames(fData.frames || []);
          }
        } catch (fErr) {
          console.error("Frame extraction error:", fErr);
        }
      }

      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Transcription failed.");
    }
  }

  // =========================================================
  // UPLOAD + TRANSCRIBE
  // =========================================================

  async function uploadAndTranscribe() {
    if (!file) {
      setErrorMsg("Please choose an audio or video file first.");
      return;
    }

    const uploadedMedia = await upload();

    if (!uploadedMedia) {
      return;
    }

    await transcribe(uploadedMedia);
  }

  // =========================================================
  // GENERATE NOTES
  // =========================================================

  async function generate() {
    if (!media) {
      setErrorMsg("Please upload and transcribe a file first.");
      return;
    }

    if (!transcript.trim()) {
      setErrorMsg("Please generate a transcript before creating notes.");
      return;
    }

    setErrorMsg("");
    setLoadingMsg(`Generating ${noteType} notes...`);

    try {
      const res = await fetch(`${API_BASE}/generate-notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          media_id: media.id,
          note_type: noteType,
          note_language: noteLanguage,
        }),
      });

      if (!res.ok) {
        let err = {};

        try {
          err = await res.json();
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(err.detail || "Generation failed");
      }

      const data = await res.json();

      setCurrentNote(data);

      await fetchNotes();

      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Note generation failed.");
    }
  }

  // =========================================================
  // TRANSLATE NOTES
  // =========================================================

  async function translate(targetLang) {
    if (!currentNote) {
      return;
    }

    setErrorMsg("");
    setLoadingMsg("Translating notes...");

    try {
      const res = await fetch(
        `${API_BASE}/notes/${currentNote.id}/translate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_language: targetLang,
          }),
        }
      );

      if (!res.ok) {
        let err = {};

        try {
          err = await res.json();
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(err.detail || "Translation failed");
      }

      const data = await res.json();

      setCurrentNote(data);

      await fetchNotes();

      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Translation failed.");
    }
  }

  // =========================================================
  // TASK EXTRACTION
  // =========================================================

  async function extractTasks() {
    if (!media) {
      setErrorMsg("Please upload a file first.");
      return;
    }

    setErrorMsg("");
    setLoadingMsg("Extracting tasks and commitments...");

    try {
      const res = await fetch(
        `${API_BASE}/tasks/extract/${media.id}`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        let err = {};

        try {
          err = await res.json();
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(err.detail || "Task extraction failed");
      }

      await fetchTasks();

      setActiveTab("Tasks & Reminders");
      setLoadingMsg("");
    } catch (err) {
      setLoadingMsg("");
      setErrorMsg(err.message || "Task extraction failed.");
    }
  }

  // =========================================================
  // AI CHAT
  // =========================================================

  async function askQuestion(e) {
    e.preventDefault();

    if (!chatQuestion.trim() || !currentNote) {
      return;
    }

    const question = chatQuestion.trim();

    setChatQuestion("");

    setChatHistory((prev) => [
      ...prev,
      {
        role: "user",
        text: question,
      },
    ]);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          note_id: currentNote.id,
          question,
        }),
      });

      if (res.ok) {
        const data = await res.json();

        setChatHistory((prev) => [
          ...prev,
          {
            role: "ai",
            text: data.answer,
          },
        ]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: "ai",
            text: "Error fetching answer.",
          },
        ]);
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Connection error.",
        },
      ]);
    }
  }

  // =========================================================
  // AUDIO RECORDING
  // =========================================================

  async function startRecording() {
    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

      mediaRecorderRef.current =
        new MediaRecorder(stream);

      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(
          audioChunksRef.current,
          {
            type: "audio/webm",
          }
        );

        const recordedFile = new File(
          [audioBlob],
          "recorded_audio.webm",
          {
            type: "audio/webm",
          }
        );

        setFile(recordedFile);

        stream.getTracks().forEach((track) => {
          track.stop();
        });
      };

      mediaRecorderRef.current.start();

      setIsRecording(true);
    } catch (err) {
      setErrorMsg(
        "Microphone access denied or not supported."
      );
    }
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      isRecording
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  // =========================================================
  // COLLABORATION - CREATE ROOM
  // =========================================================

  async function createRoom() {
    if (!userName.trim()) {
      setErrorMsg("Please enter your name first.");
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/collaboration/rooms`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        throw new Error("Failed to create room.");
      }

      const data = await res.json();

      setRoomId(data.room_id);

      joinRoom(data.room_id);
    } catch (err) {
      setErrorMsg(
        err.message || "Failed to create room."
      );
    }
  }

  // =========================================================
  // COLLABORATION - JOIN ROOM
  // =========================================================

  function joinRoom(idToJoin) {
    const targetRoom =
      idToJoin || roomId;

    if (!targetRoom.trim()) {
      setErrorMsg("Please enter a room ID.");
      return;
    }

    if (!userName.trim()) {
      setErrorMsg("Please enter your name first.");
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl =
      `wss://ai-smart-transcription-platform.onrender.com/api/collaboration/${targetRoom.trim()}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnectedRoom(
        targetRoom.trim()
      );

      ws.send(
        JSON.stringify({
          type: "join",
          user_id: userName,
          user_name: userName,
        })
      );
    };

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === "room_state") {
          setRoomUsers(msg.users || []);
        } else if (msg.type === "room_message") {
          setRoomMessages((prev) => [
            ...prev,
            {
              user: msg.user_name,
              text: msg.message,
            },
          ]);
        } else if (msg.type === "signal") {
          handleSignal(
            msg.from,
            msg.signal
          );
        }
      } catch (err) {
        console.error(
          "WebSocket message error:",
          err
        );
      }
    };

    ws.onerror = () => {
      setErrorMsg(
        "Unable to connect to the collaboration server."
      );
    };

    ws.onclose = () => {
      setConnectedRoom("");
      setRoomUsers([]);
    };

    wsRef.current = ws;
  }

  // =========================================================
  // VOICE COLLABORATION
  // =========================================================

  async function toggleVoice() {
    if (
      !connectedRoom ||
      !wsRef.current
    ) {
      return;
    }

    if (!voiceActive) {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
          });

        localStreamRef.current = stream;

        setVoiceActive(true);

        wsRef.current.send(
          JSON.stringify({
            type: "voice_state",
            enabled: true,
          })
        );

        initiatePeerConnections();
      } catch (e) {
        setErrorMsg(
          "Failed to access microphone for voice chat."
        );
      }
    } else {
      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }

      setVoiceActive(false);

      wsRef.current.send(
        JSON.stringify({
          type: "voice_state",
          enabled: false,
        })
      );
    }
  }

  // =========================================================
  // WEBRTC
  // =========================================================

  function initiatePeerConnections() {
    roomUsers.forEach((u) => {
      if (
        u.user_id !== userName &&
        u.voice_enabled
      ) {
        createPeerConnection(
          u.user_id,
          true
        );
      }
    });
  }

  function createPeerConnection(
    targetUserId,
    isInitiator
  ) {
    const pc =
      new RTCPeerConnection({
        iceServers: [
          {
            urls:
              "stun:stun.l.google.com:19302",
          },
        ],
      });

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          pc.addTrack(
            track,
            localStreamRef.current
          );
        });
    }

    pc.onicecandidate = (event) => {
      if (
        event.candidate &&
        wsRef.current
      ) {
        wsRef.current.send(
          JSON.stringify({
            type: "signal",
            target: targetUserId,
            signal: {
              candidate:
                event.candidate,
            },
          })
        );
      }
    };

    pc.ontrack = (event) => {
      const audioEl =
        new Audio();

      audioEl.srcObject =
        event.streams[0];

      audioEl
        .play()
        .catch(console.error);
    };

    if (isInitiator) {
      pc.createOffer()
        .then((offer) => {
          return pc.setLocalDescription(
            offer
          );
        })
        .then(() => {
          if (wsRef.current) {
            wsRef.current.send(
              JSON.stringify({
                type: "signal",
                target: targetUserId,
                signal: {
                  sdp: pc.localDescription,
                },
              })
            );
          }
        })
        .catch(console.error);
    }

    peerConnections.current[
      targetUserId
    ] = pc;

    return pc;
  }

  async function handleSignal(
    fromUser,
    signal
  ) {
    let pc =
      peerConnections.current[
        fromUser
      ];

    if (!pc) {
      pc = createPeerConnection(
        fromUser,
        false
      );
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(
        new RTCSessionDescription(
          signal.sdp
        )
      );

      if (
        signal.sdp.type === "offer"
      ) {
        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        if (wsRef.current) {
          wsRef.current.send(
            JSON.stringify({
              type: "signal",
              target: fromUser,
              signal: {
                sdp: answer,
              },
            })
          );
        }
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(
        new RTCIceCandidate(
          signal.candidate
        )
      );
    }
  }

  // =========================================================
  // SEND ROOM MESSAGE
  // =========================================================

  function sendRoomMessage(e) {
    e.preventDefault();

    if (
      !roomInput.trim() ||
      !wsRef.current
    ) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "room_message",
        message: roomInput,
      })
    );

    setRoomInput("");
  }

  // =========================================================
  // USERNAME SCREEN
  // =========================================================

  if (showNamePrompt) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
        <div className="w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-slate-950/95 p-8 shadow-2xl">
          <div className="flex justify-center mb-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-2xl shadow-lg shadow-rose-500/20">
              🎙️
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">
              Welcome to AI Smart Notes
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Before you begin, please enter your name.
            </p>
          </div>

          <div className="mt-6">
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Your Name
            </label>

            <input
              type="text"
              value={userName}
              onChange={(e) =>
                setUserName(
                  e.target.value
                )
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter"
                ) {
                  handleNameSubmit();
                }
              }}
              placeholder="Enter your name"
              autoFocus
              maxLength={50}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-rose-500/60 focus:ring-2 focus:ring-rose-500/10"
            />

            <button
              onClick={
                handleNameSubmit
              }
              disabled={
                !userName.trim()
              }
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-950/20 transition-all hover:from-rose-600 hover:to-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-600">
            Your name is only used while this page is open.
          </p>
        </div>
      </div>
    );
  }

  // =========================================================
  // MAIN APPLICATION
  // =========================================================

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-950/80 backdrop-blur-xl border-r border-slate-800/80 flex flex-col justify-between shrink-0 z-20">
        <div>
          <div className="p-6 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white font-bold shadow-lg shadow-rose-500/20">
              🎙️
            </div>

            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              AI Smart Notes
            </span>
          </div>

          <nav className="px-3 space-y-1">
            {[
              { id: "Home", icon: "🏠" },
              { id: "Transcribe", icon: "⬆️" },
              { id: "My Notes", icon: "📑" },
              { id: "Chat with Notes", icon: "💬" },
              { id: "Tasks & Reminders", icon: "☑️" },
              { id: "Multimedia", icon: "🖼️" },
              { id: "Export", icon: "📥" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() =>
                  setActiveTab(tab.id)
                }
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                }`}
              >
                <span className="text-base">
                  {tab.icon}
                </span>

                {tab.id}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/80">
          <div className="mb-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-600">
              Signed in as
            </p>

            <p className="text-xs text-slate-300 truncate mt-1">
              {userName}
            </p>
          </div>

          <button
            onClick={() =>
              setActiveTab("Collab")
            }
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700/50 transition-all"
          >
            👥 Collab Online
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-slate-950/60 overflow-y-auto">
        <header className="px-8 py-6 border-b border-slate-800/60 flex justify-between items-center bg-slate-950/40 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              Transform Audio & Video into Smart Notes
            </h1>

            <p className="text-xs text-slate-400 mt-1">
              Transcribe, understand, organize and act on your content using AI.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden sm:block">
              {userName}
            </span>

            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-xs font-bold text-white shadow-md">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {errorMsg && (
          <div className="mx-8 mt-4 p-3 bg-red-950/40 border border-red-500/30 text-red-300 rounded-xl text-sm flex justify-between items-center animate-fade-in">
            <span>{errorMsg}</span>

            <button
              onClick={() =>
                setErrorMsg("")
              }
              className="text-red-400 hover:text-red-200"
            >
              ×
            </button>
          </div>
        )}

        {loadingMsg && (
          <div className="mx-8 mt-4 p-3 bg-amber-950/40 border border-amber-500/30 text-amber-300 rounded-xl text-sm flex items-center gap-2 animate-pulse">
            <span className="animate-spin text-base">
              ⏳
            </span>

            <span>{loadingMsg}</span>
          </div>
        )}

        <div className="p-8 flex-1">
          {/* =====================================================
              HOME / TRANSCRIBE
          ====================================================== */}
          {activeTab === "Home" ||
          activeTab === "Transcribe" ? (
            <div className="space-y-6">
              {/* Note Types Selector */}
              <div className="grid grid-cols-4 gap-4">
                {[
                  {
                    id: "summary",
                    label: "Summary",
                    desc: "General overview with key insights",
                  },
                  {
                    id: "meeting",
                    label: "Meeting",
                    desc: "Decisions, discussions and action items",
                  },
                  {
                    id: "lecture",
                    label: "Lecture",
                    desc: "Concepts, explanations and revision",
                  },
                  {
                    id: "task",
                    label: "Task",
                    desc: "Tasks, priorities and deadlines",
                  },
                ].map((item) => (
                  <div
                    key={item.id}
                    onClick={() =>
                      setNoteType(item.id)
                    }
                    className={`cursor-pointer p-4 rounded-xl border transition-all duration-200 ${
                      noteType === item.id
                        ? "bg-slate-900/90 border-rose-500/40 shadow-md shadow-rose-950/20"
                        : "bg-slate-900/30 border-slate-800/60 hover:border-slate-700/60"
                    }`}
                  >
                    <div className="text-lg mb-1">
                      📄
                    </div>

                    <h3 className="font-semibold text-slate-200 text-sm">
                      {item.label}
                    </h3>

                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>

              {/* Upload & Transcription */}
              <div className="grid grid-cols-2 gap-6">
                {/* Upload Card */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="border border-dashed border-slate-700/60 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-950/20 hover:border-slate-600 transition-all">
                      <span className="text-3xl text-rose-500 mb-2">
                        ⬆️
                      </span>

                      <h4 className="font-semibold text-sm text-slate-200">
                        Upload Audio or Video
                      </h4>

                      <p className="text-xs text-slate-500 mt-1">
                        MP3, WAV, M4A, MP4, MOV, WEBM
                      </p>

                      <input
                        type="file"
                        id="mediaFile"
                        accept="audio/*,video/*"
                        className="hidden"
                        onChange={(e) => {
                          const selectedFile =
                            e.target.files?.[0] ||
                            null;

                          setFile(
                            selectedFile
                          );

                          setMedia(null);
                          setTranscript("");
                          setFrames([]);
                        }}
                      />

                      <label
                        htmlFor="mediaFile"
                        className="mt-4 px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 cursor-pointer transition-all"
                      >
                        {file
                          ? file.name
                          : "Choose File"}
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-400 block mb-1">
                          Transcription Language
                        </label>

                        <select
                          value={
                            transcriptionLang
                          }
                          onChange={(e) =>
                            setTranscriptionLang(
                              e.target.value
                            )
                          }
                          className="w-full bg-slate-950/80 border border-slate-800 rounded-lg p-2 text-xs text-slate-300 outline-none focus:border-rose-500/50"
                        >
                          <option value="auto">
                            Auto detect
                          </option>

                          <option value="en">
                            English
                          </option>

                          <option value="es">
                            Spanish
                          </option>

                          <option value="fr">
                            French
                          </option>

                          <option value="de">
                            German
                          </option>

                          <option value="hi">
                            Hindi
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-400 block mb-1">
                          Note Language
                        </label>

                        <select
                          value={
                            noteLanguage
                          }
                          onChange={(e) =>
                            setNoteLanguage(
                              e.target.value
                            )
                          }
                          className="w-full bg-slate-950/80 border border-slate-800 rounded-lg p-2 text-xs text-slate-300 outline-none focus:border-rose-500/50"
                        >
                          <option value="en">
                            English
                          </option>

                          <option value="es">
                            Spanish
                          </option>

                          <option value="fr">
                            French
                          </option>

                          <option value="de">
                            German
                          </option>

                          <option value="hi">
                            Hindi
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={
                        isRecording
                          ? stopRecording
                          : startRecording
                      }
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                        isRecording
                          ? "bg-rose-500/20 border-rose-500 text-rose-400 animate-pulse"
                          : "bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-300"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-rose-500"></span>

                      {isRecording
                        ? "Stop Recording"
                        : "Record Audio"}
                    </button>

                    <button
                      onClick={
                        uploadAndTranscribe
                      }
                      disabled={
                        !file ||
                        Boolean(loadingMsg)
                      }
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs shadow-md shadow-rose-950/20 transition-all flex items-center justify-center gap-1.5"
                    >
                      ▶️ Upload & Transcribe
                    </button>
                  </div>
                </div>

                {/* Transcript Card */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold text-sm text-slate-200">
                        Transcript
                      </h4>

                      <span className="text-xs bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700/50 uppercase">
                        {noteType} mode
                      </span>
                    </div>

                    <textarea
                      value={transcript}
                      onChange={(e) =>
                        setTranscript(
                          e.target.value
                        )
                      }
                      placeholder="Your transcript will appear here after transcription. You can also paste transcript text for testing."
                      className="w-full h-48 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-300 outline-none focus:border-rose-500/50 resize-none font-mono"
                    />
                  </div>

                  <div className="space-y-3 mt-4">
                    <div className="flex gap-3">
                      <button
                        onClick={generate}
                        disabled={
                          !media ||
                          !transcript.trim()
                        }
                        className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs shadow-md shadow-rose-950/20 transition-all"
                      >
                        Generate{" "}
                        {noteType
                          .charAt(0)
                          .toUpperCase() +
                          noteType.slice(1)}{" "}
                        Notes
                      </button>

                      <button
                        onClick={
                          extractTasks
                        }
                        disabled={!media}
                        className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-semibold border border-slate-700 transition-all"
                      >
                        Extract Action Items
                      </button>
                    </div>

                    {frames.length >
                      0 && (
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        🖼️{" "}
                        {frames.length}{" "}
                        visual items detected.
                        Open Multimedia to view them.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Note Display Card */}
              {currentNote && (
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-800/60">
                    <div>
                      <span className="text-xs font-bold text-rose-500 tracking-wider uppercase">
                        {
                          currentNote.note_type
                        }
                      </span>

                      <h2 className="text-xl font-bold text-slate-100 mt-1">
                        {currentNote.title}
                      </h2>
                    </div>

                    <div className="flex gap-2">
                      {[
                        "es",
                        "fr",
                        "de",
                        "hi",
                      ].map(
                        (lang) => (
                          <button
                            key={lang}
                            onClick={() =>
                              translate(
                                lang
                              )
                            }
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs uppercase font-medium border border-slate-700"
                          >
                            {lang}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {Object.entries(
                      currentNote.content ||
                        {}
                    ).map(
                      ([k, val]) => (
                        <div
                          key={k}
                          className="space-y-1"
                        >
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {currentNote.labels?.[
                              k
                            ] || k}
                          </h4>

                          {Array.isArray(
                            val
                          ) ? (
                            <ul className="list-disc list-inside text-xs text-slate-300 space-y-1 pl-1">
                              {val.map(
                                (
                                  item,
                                  idx
                                ) => (
                                  <li
                                    key={
                                      idx
                                    }
                                  >
                                    {typeof item ===
                                    "object"
                                      ? JSON.stringify(
                                          item
                                        )
                                      : item}
                                  </li>
                                )
                              )}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                              {val}
                            </p>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab ===
            "My Notes" ? (
            /* =====================================================
               MY NOTES
            ====================================================== */
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-100">
                Saved Notes
              </h2>

              <div className="grid grid-cols-3 gap-4">
                {allNotes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      setCurrentNote(n);
                      setActiveTab(
                        "Home"
                      );
                    }}
                    className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-rose-500/40 cursor-pointer transition-all space-y-2"
                  >
                    <span className="text-xs font-bold text-rose-500 uppercase">
                      {n.note_type}
                    </span>

                    <h3 className="font-semibold text-sm text-slate-200 line-clamp-1">
                      {n.title}
                    </h3>

                    <p className="text-xs text-slate-500">
                      {n.created_at
                        ? new Date(
                            n.created_at
                          ).toLocaleDateString()
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab ===
            "Chat with Notes" ? (
            /* =====================================================
               CHAT
            ====================================================== */
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md flex flex-col h-[550px]">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                {!currentNote ? (
                  <p className="text-xs text-slate-500 text-center mt-20">
                    Select or generate a
                    note to start chatting.
                  </p>
                ) : (
                  chatHistory.map(
                    (msg, i) => (
                      <div
                        key={i}
                        className={`flex ${
                          msg.role ===
                          "user"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`p-3 rounded-xl text-xs max-w-md leading-relaxed ${
                            msg.role ===
                            "user"
                              ? "bg-rose-500/20 border border-rose-500/30 text-rose-200"
                              : "bg-slate-800/80 border border-slate-700/60 text-slate-300"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              <form
                onSubmit={askQuestion}
                className="flex gap-2 mt-4 pt-3 border-t border-slate-800/60"
              >
                <input
                  type="text"
                  placeholder="Ask a question about the current note..."
                  value={chatQuestion}
                  onChange={(e) =>
                    setChatQuestion(
                      e.target.value
                    )
                  }
                  className="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-300 outline-none focus:border-rose-500/50"
                />

                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-rose-950/20"
                >
                  Send
                </button>
              </form>
            </div>
          ) : activeTab ===
            "Tasks & Reminders" ? (
            /* =====================================================
               TASKS
            ====================================================== */
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-100">
                Extracted Action Items
              </h2>

              <div className="space-y-3">
                {tasks.length ===
                0 ? (
                  <p className="text-xs text-slate-500">
                    No tasks extracted yet.
                    Click "Extract Action
                    Items" on a transcript.
                  </p>
                ) : (
                  tasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl flex justify-between items-center"
                    >
                      <div>
                        <h4 className="font-semibold text-sm text-slate-200">
                          {t.title}
                        </h4>

                        <p className="text-xs text-slate-400 mt-0.5">
                          {t.description}
                        </p>
                      </div>

                      <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-rose-400 border border-slate-700">
                        {t.priority}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : activeTab ===
            "Multimedia" ? (
            /* =====================================================
               MULTIMEDIA
            ====================================================== */
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-100">
                Extracted Visual Frames
              </h2>

              <div className="grid grid-cols-2 gap-4">
                {frames.length ===
                0 ? (
                  <p className="text-xs text-slate-500">
                    No frames extracted.
                    Upload and transcribe a
                    video file to see
                    keyframes.
                  </p>
                ) : (
                  frames.map(
                    (f, i) => (
                      <div
                        key={i}
                        className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl space-y-2"
                      >
                        <h4 className="font-semibold text-sm text-slate-200">
                          {f.analysis
                            ?.title ||
                            f.filename}
                        </h4>

                        <p className="text-xs text-slate-400">
                          {
                            f.analysis
                              ?.description
                          }
                        </p>

                        {f.analysis
                          ?.extracted_text && (
                          <pre className="text-xs bg-slate-950 p-2 rounded border border-slate-800 text-slate-400 overflow-x-auto font-mono">
                            {
                              f.analysis
                                .extracted_text
                            }
                          </pre>
                        )}
                      </div>
                    )
                  )
                )}
              </div>
            </div>
          ) : activeTab ===
            "Export" ? (
            /* =====================================================
               EXPORT
            ====================================================== */
            <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-xl space-y-4 max-w-lg">
              <h2 className="text-lg font-bold text-slate-100">
                Export Note
              </h2>

              {!currentNote ? (
                <p className="text-xs text-slate-500">
                  Generate or select a
                  note to export.
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-300">
                    Export{" "}
                    <strong>
                      {currentNote.title}
                    </strong>
                    :
                  </p>

                  <div className="flex gap-2">
                    {[
                      "pdf",
                      "docx",
                      "txt",
                      "json",
                    ].map((fmt) => (
                      <a
                        key={fmt}
                        href={`${API_BASE}/export/${currentNote.id}/${fmt}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold uppercase border border-slate-700"
                      >
                        {fmt}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab ===
            "Collab" ? (
            /* =====================================================
               COLLABORATION
            ====================================================== */
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md space-y-4 max-w-xl">
              <h2 className="text-lg font-bold text-slate-100">
                Real-Time Team Collaboration
              </h2>

              <p className="text-xs text-slate-500">
                Collaborating as{" "}
                <span className="text-rose-400 font-semibold">
                  {userName}
                </span>
              </p>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Your Name"
                    value={userName}
                    onChange={(e) =>
                      setUserName(
                        e.target.value
                      )
                    }
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300"
                  />

                  <button
                    onClick={
                      createRoom
                    }
                    className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-semibold"
                  >
                    Create Room
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Room ID"
                    value={roomId}
                    onChange={(e) =>
                      setRoomId(
                        e.target.value
                      )
                    }
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300"
                  />

                  <button
                    onClick={() =>
                      joinRoom(
                        roomId
                      )
                    }
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold border border-slate-700"
                  >
                    Join
                  </button>
                </div>

                {connectedRoom && (
                  <div className="mt-4 p-4 border border-slate-800 rounded-xl space-y-3 bg-slate-950/40">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400">
                        Connected Room:{" "}
                        <strong>
                          {
                            connectedRoom
                          }
                        </strong>
                      </span>

                      <button
                        onClick={
                          toggleVoice
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          voiceActive
                            ? "bg-rose-500 text-white animate-pulse"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {voiceActive
                          ? "Mute Voice"
                          : "Enable Voice Chat"}
                      </button>
                    </div>

                    <div className="text-xs text-slate-400">
                      Users:{" "}
                      {roomUsers
                        .map(
                          (u) =>
                            u.user_name
                        )
                        .join(
                          ", "
                        )}
                    </div>

                    <div className="h-40 overflow-y-auto space-y-2 border border-slate-800 p-2 rounded-lg bg-slate-950/60 text-xs">
                      {roomMessages.map(
                        (m, i) => (
                          <div
                            key={i}
                          >
                            <strong className="text-rose-400">
                              {
                                m.user
                              }
                              :{" "}
                            </strong>

                            <span className="text-slate-300">
                              {
                                m.text
                              }
                            </span>
                          </div>
                        )
                      )}
                    </div>

                    <form
                      onSubmit={
                        sendRoomMessage
                      }
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        placeholder="Say something to room..."
                        value={
                          roomInput
                        }
                        onChange={(
                          e
                        ) =>
                          setRoomInput(
                            e.target
                              .value
                          )
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300"
                      />

                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);