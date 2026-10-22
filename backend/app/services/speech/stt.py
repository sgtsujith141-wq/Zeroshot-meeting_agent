"""Speech-to-text provider selection. There is no simulated provider.

STT_PROVIDER=auto (default): Sarvam if SARVAM_API_KEY is set, else local Whisper if
installed, else STTUnavailable (import a transcript instead).
"""

from __future__ import annotations

import os
from pathlib import Path

from ...config import get_settings
from . import sarvam, whisper_local
from .sarvam import STTError, STTUnavailable

__all__ = ["STTError", "STTUnavailable", "choose", "status", "transcribe"]


def choose() -> str:
    pref = os.getenv("STT_PROVIDER", "auto").lower()
    s = get_settings()
    if pref == "sarvam" or (pref == "auto" and s.sarvam_api_key):
        return "sarvam"
    if pref in ("whisper", "auto") and whisper_local.available():
        return "whisper"
    raise STTUnavailable("No speech-to-text provider: set SARVAM_API_KEY (Sarvam saaras:v4, diarization) or "
                         "install the local Whisper fallback with `uv sync --group local-stt`; "
                         "or import a transcript instead")


def transcribe(audio_path: Path) -> tuple[list[dict], dict]:
    if choose() == "sarvam":
        return sarvam.transcribe(audio_path)
    return whisper_local.transcribe(audio_path)


def status() -> dict:
    s = get_settings()
    try:
        active = choose()
    except STTUnavailable as exc:
        active = None
        reason = str(exc)
    else:
        reason = None
    return {"active": active, "reason": reason, "preference": os.getenv("STT_PROVIDER", "auto"),
            "sarvam": {"api_key_present": bool(s.sarvam_api_key), "model": s.sarvam_model, "mode": s.sarvam_mode,
                       "diarization": True},
            "whisper_local": {"installed": whisper_local.available(), "model": f"faster-whisper-{whisper_local.model_name()}",
                              "diarization": False}}
