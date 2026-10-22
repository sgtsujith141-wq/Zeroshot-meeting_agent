"""Upload validation and FFmpeg normalisation (argument lists only, never a shell)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import uuid
from pathlib import Path

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".opus"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm"}
TRANSCRIPT_EXT = {".json", ".txt", ".vtt", ".srt"}
MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024
FFPROBE_TIMEOUT = 30
FFMPEG_TIMEOUT = 900


class MediaError(ValueError):
    pass


def safe_display_name(name: str) -> str:
    base = Path(name or "upload").name
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:120].strip(" .") or "upload"
    return base


def classify(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    if ext in TRANSCRIPT_EXT:
        return "transcript"
    raise MediaError(f"file type '{ext or '?'}' is not allowed")


def storage_path(uploads_dir: Path, meeting_id: int, filename: str) -> Path:
    """Server-chosen name inside the private uploads dir (no user-controlled path parts)."""
    d = uploads_dir / f"meeting-{int(meeting_id)}"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def probe(path: Path) -> dict:
    if not shutil.which("ffprobe"):
        raise MediaError("ffprobe is not installed")
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=FFPROBE_TIMEOUT, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaError("ffprobe timed out") from exc
    if out.returncode != 0:
        raise MediaError("file is not a readable audio/video container")
    info = json.loads(out.stdout or "{}")
    streams = info.get("streams", [])
    if not any(s.get("codec_type") == "audio" for s in streams):
        raise MediaError("no audio stream found")
    dur = float(info.get("format", {}).get("duration") or 0.0)
    return {"duration_seconds": dur, "format": info.get("format", {}).get("format_name")}


def normalise_audio(src: Path) -> Path:
    """Extract/convert to 16 kHz mono WAV for STT."""
    dst = src.with_suffix(".16k.wav")
    try:
        out = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
             "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
            capture_output=True, text=True, timeout=FFMPEG_TIMEOUT, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaError("ffmpeg timed out") from exc
    if out.returncode != 0:
        raise MediaError("ffmpeg could not convert the file")
    return dst
