import os
import subprocess
import re
from pathlib import Path
import cv2
import imageio_ffmpeg

VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}

def is_video(path: str) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXT

def extract_audio(video_path: str, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, Path(video_path).stem + "_audio.wav")
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg_path,
        "-y",
        "-i", video_path,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        out,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return out

def _frame_difference(a, b):
    if a is None or b is None:
        return 1.0
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    return float(cv2.absdiff(ga, gb).mean()) / 255.0

def extract_frames(
    video_path: str,
    out_dir: str,
    every_seconds: int = 30,
    max_frames: int = 8,  # Kept small to stay within Render's 512MB RAM & timeout limit
):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if fps else 0

    if duration <= 0:
        cap.release()
        return []

    # Calculate intervals to pick at most 8 evenly distributed timestamps
    interval = max(float(every_seconds), duration / max_frames)
    timestamps = []
    curr_t = 2.0  # start 2s in to avoid black intro screens
    while curr_t < duration and len(timestamps) < max_frames:
        timestamps.append(curr_t)
        curr_t += interval

    frames = []
    for index, t in enumerate(timestamps):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue

        # Downscale frame resolution to save disk space and RAM (max 720p width)
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (1280, int(h * scale)))

        path = os.path.join(out_dir, f"frame_{index:03d}_{int(t)}s.jpg")
        cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        frames.append({
            "path": path,
            "timestamp": round(t, 2),
            "difference": 0.5
        })

    cap.release()
    return frames