import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import imageio_ffmpeg


VIDEO_EXT = {
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
    ".m4v"
}

AUDIO_EXT = {
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".webm"
}


def is_video(path: str) -> bool:
    """
    Check whether a file is a supported video.
    """
    return Path(path).suffix.lower() in VIDEO_EXT


def is_audio(path: str) -> bool:
    """
    Check whether a file is a supported audio file.
    """
    return Path(path).suffix.lower() in AUDIO_EXT


def extract_audio(video_path: str) -> str:
    """
    Extract a temporary 16 kHz mono WAV from a video.

    The temporary directory can be deleted immediately
    after Gemini finishes transcription.
    """

    if not os.path.exists(video_path):
        raise FileNotFoundError(
            f"Video file not found: {video_path}"
        )

    temp_dir = tempfile.mkdtemp(
        prefix="ai_smart_notes_audio_"
    )

    output_path = os.path.join(
        temp_dir,
        f"{Path(video_path).stem}_audio.wav"
    )

    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()

    command = [
        ffmpeg_path,
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        output_path
    ]

    try:
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

    except subprocess.CalledProcessError as exc:
        shutil.rmtree(
            temp_dir,
            ignore_errors=True
        )

        error_message = (
            exc.stderr.decode(
                "utf-8",
                errors="ignore"
            )
            if exc.stderr
            else "FFmpeg audio extraction failed."
        )

        raise RuntimeError(
            error_message
        ) from exc

    return output_path


def cleanup_temp_audio(audio_path: str | None):
    """
    Delete the temporary audio file and its temporary directory.
    """

    if not audio_path:
        return

    try:
        temp_dir = os.path.dirname(audio_path)

        if (
            temp_dir
            and os.path.basename(temp_dir).startswith(
                "ai_smart_notes_audio_"
            )
        ):
            shutil.rmtree(
                temp_dir,
                ignore_errors=True
            )
        elif os.path.exists(audio_path):
            os.remove(audio_path)

    except Exception:
        pass


def get_video_info(video_path: str):
    """
    Get basic video information.
    """

    if not os.path.exists(video_path):
        raise FileNotFoundError(
            f"Video file not found: {video_path}"
        )

    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise RuntimeError(
            "Unable to open video."
        )

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    frame_count = cap.get(
        cv2.CAP_PROP_FRAME_COUNT
    )

    width = int(
        cap.get(
            cv2.CAP_PROP_FRAME_WIDTH
        )
    )

    height = int(
        cap.get(
            cv2.CAP_PROP_FRAME_HEIGHT
        )
    )

    duration = (
        frame_count / fps
        if fps and fps > 0
        else 0
    )

    cap.release()

    return {
        "fps": fps,
        "frame_count": frame_count,
        "width": width,
        "height": height,
        "duration": duration
    }


def extract_frames(
    video_path: str,
    output_dir: str | None = None,
    every_seconds: int = 45,
    max_frames: int = 8
):
    """
    Extract a limited number of video frames.

    Default:
        one frame every 45 seconds
        maximum 8 frames

    This is deliberately throttled for Render's limited resources.
    """

    if not os.path.exists(video_path):
        raise FileNotFoundError(
            f"Video file not found: {video_path}"
        )

    if output_dir is None:
        output_dir = tempfile.mkdtemp(
            prefix="ai_smart_notes_frames_"
        )
    else:
        os.makedirs(
            output_dir,
            exist_ok=True
        )

    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise RuntimeError(
            "Unable to open video for frame extraction."
        )

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    frame_count = int(
        cap.get(
            cv2.CAP_PROP_FRAME_COUNT
        )
    )

    if not fps or fps <= 0:
        fps = 25.0

    duration = (
        frame_count / fps
        if frame_count > 0
        else 0
    )

    frames = []

    timestamps = []

    current_time = 0.0

    while (
        current_time <= duration
        and len(timestamps) < max_frames
    ):
        timestamps.append(
            current_time
        )

        current_time += every_seconds

    for index, timestamp in enumerate(timestamps):

        cap.set(
            cv2.CAP_PROP_POS_MSEC,
            timestamp * 1000
        )

        success, frame = cap.read()

        if not success:
            continue

        # Resize large frames to reduce disk usage.
        height, width = frame.shape[:2]

        max_width = 1280

        if width > max_width:
            scale = max_width / width

            new_width = max_width
            new_height = int(
                height * scale
            )

            frame = cv2.resize(
                frame,
                (new_width, new_height),
                interpolation=cv2.INTER_AREA
            )

        frame_path = os.path.join(
            output_dir,
            f"frame_{index + 1:02d}_{int(timestamp)}s.jpg"
        )

        success = cv2.imwrite(
            frame_path,
            frame,
            [
                cv2.IMWRITE_JPEG_QUALITY,
                75
            ]
        )

        if not success:
            continue

        frames.append(
            {
                "index": index + 1,
                "timestamp": round(
                    timestamp,
                    2
                ),
                "path": frame_path,
                "filename": os.path.basename(
                    frame_path
                )
            }
        )

    cap.release()

    return frames


def cleanup_frames(frames):
    """
    Delete extracted frame files and temporary directories.
    """

    if not frames:
        return

    directories = set()

    for frame in frames:

        path = frame.get("path")

        if not path:
            continue

        try:
            if os.path.exists(path):
                os.remove(path)

            directories.add(
                os.path.dirname(path)
            )

        except Exception:
            pass

    for directory in directories:
        try:
            if os.path.isdir(directory):
                if not os.listdir(directory):
                    os.rmdir(directory)
        except Exception:
            pass