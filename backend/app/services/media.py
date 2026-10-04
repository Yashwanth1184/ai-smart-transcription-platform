import os
import subprocess
import re

from pathlib import Path

import cv2
import imageio_ffmpeg


VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}

AUDIO_EXT = {
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
}


def is_video(path: str) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXT


def extract_audio(video_path: str, out_dir: str) -> str:
    """
    Extract audio from a video using the FFmpeg executable
    bundled with imageio-ffmpeg.

    The output is a 16 kHz, mono WAV file suitable for
    speech-to-text processing.
    """

    os.makedirs(out_dir, exist_ok=True)

    out = os.path.join(
        out_dir,
        Path(video_path).stem + "_audio.wav",
    )

    # Get the FFmpeg executable bundled with imageio-ffmpeg.
    # This works on Render without requiring apt-get.
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()

    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        out,
    ]

    subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    return out


def _frame_difference(a, b):
    """
    Calculate the visual difference between two frames.
    """

    if a is None or b is None:
        return 1.0

    a = cv2.resize(a, (160, 90))
    b = cv2.resize(b, (160, 90))

    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)

    return float(cv2.absdiff(ga, gb).mean()) / 255.0


def extract_frames(
    video_path: str,
    out_dir: str,
    every_seconds: int = 60,
    max_frames: int = 120,
):
    """
    Extract representative frames for long videos.

    Samples the video once per minute, scores visual changes,
    and keeps representative frames.

    The extracted frames can later be used for automatic
    multimedia/visual analysis.
    """

    os.makedirs(out_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise RuntimeError(
            "Could not open the video. "
            "Check the file and video codec support."
        )

    fps = cap.get(cv2.CAP_PROP_FPS) or 25

    frame_count = int(
        cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    )

    duration = frame_count / fps if fps else 0

    if duration <= 0:
        cap.release()
        return []

    # Sample at least once every 60 seconds.
    sample_interval = max(
        60.0,
        float(every_seconds),
    )

    candidates = []

    previous = None
    t = 0.0

    while t < duration:

        cap.set(
            cv2.CAP_PROP_POS_MSEC,
            t * 1000,
        )

        ok, frame = cap.read()

        if ok:
            difference = _frame_difference(
                previous,
                frame,
            )

            candidates.append(
                (
                    difference,
                    t,
                    frame.copy(),
                )
            )

            previous = frame

        t += sample_interval

    cap.release()

    if not candidates:
        return []

    # Keep a few evenly distributed anchor frames.
    selected = []

    anchor_count = min(
        6,
        len(candidates),
    )

    if anchor_count:
        step = max(
            1,
            len(candidates) // anchor_count,
        )

        selected.extend(
            candidates[::step][:anchor_count]
        )

    # Rank remaining frames by visual difference.
    ranked = sorted(
        candidates[1:],
        key=lambda x: x[0],
        reverse=True,
    )

    for candidate in ranked:

        if len(selected) >= max_frames:
            break

        # Avoid selecting frames that are too close
        # to an already selected frame.
        if all(
            abs(candidate[1] - x[1]) >= 10
            for x in selected
        ):
            selected.append(candidate)

    # Sort selected frames chronologically.
    selected = sorted(
        selected,
        key=lambda x: x[1],
    )[:max_frames]

    frames = []

    for index, (
        difference,
        timestamp,
        frame,
    ) in enumerate(selected):

        path = os.path.join(
            out_dir,
            f"frame_{index:03d}_{int(timestamp)}s.jpg",
        )

        cv2.imwrite(
            path,
            frame,
            [
                cv2.IMWRITE_JPEG_QUALITY,
                82,
            ],
        )

        frames.append(
            {
                "path": path,
                "timestamp": round(
                    timestamp,
                    2,
                ),
                "difference": round(
                    difference,
                    4,
                ),
            }
        )

    return frames


def extract_code_blocks(text: str):
    """
    Extract fenced code blocks from text.
    """

    blocks = re.findall(
        r"```(?:[\w+#.-]+)?\s*\n?(.*?)```",
        text,
        flags=re.S,
    )

    return [
        block.strip()
        for block in blocks
        if block.strip()
    ]