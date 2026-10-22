"""Local speech-to-text fallback with faster-whisper (no API key, nothing leaves the machine).

Install with `uv sync --group local-stt`. Limitations, stated in the UI and docs:
- no speaker diarization: every segment is SPEAKER_00 until the organiser splits/renames;
- segment-level timestamps (Whisper segments), not word level;
- Kannada/Hindi quality of the `small` model is limited (on a synthetic clip, Kannada came
  out phonetically in Devanagari script). Sarvam saaras:v4 (codemix, diarization) is the
  intended provider for code-mixed meetings.
"""

from __future__ import annotations

import importlib.util
import os
import threading
from pathlib import Path

from ..transcripts import _finish, normalise_chunks

_models: dict[str, object] = {}
_lock = threading.Lock()


def available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def model_name() -> str:
    return os.getenv("WHISPER_MODEL", "small")


def _model(size: str):  # noqa: ANN202
    with _lock:
        if size not in _models:
            from faster_whisper import WhisperModel
            _models[size] = WhisperModel(size, device="cpu", compute_type="int8")
        return _models[size]


def _pcm16_wav(path: Path):  # noqa: ANN202
    """Samples of the 16 kHz mono PCM WAV that media.normalise_audio produces. Decoding it
    here avoids faster-whisper's PyAV path (PyAV/faster-whisper version mismatch)."""
    import wave

    import numpy as np
    with wave.open(str(path), "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
            raise ValueError("expected 16 kHz mono 16-bit WAV (run media.normalise_audio first)")
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(audio_path: Path, *, language: str | None = None) -> tuple[list[dict], dict]:
    size = model_name()
    lang = language or os.getenv("WHISPER_LANGUAGE") or None  # None = auto-detect per file
    # multilingual=True re-detects the language per segment: on a code-mixed test clip the
    # default (one language from the first 30 s) TRANSLATED a Kannada line with inverted
    # meaning; per-segment detection keeps the spoken words (WER 0.34 -> 0.25, docs/evaluation.md).
    segments, info = _model(size).transcribe(_pcm16_wav(Path(audio_path)), language=lang, vad_filter=True,
                                             beam_size=5, multilingual=lang is None)
    rows = [{"speaker": "SPEAKER_00", "start": s.start, "end": s.end, "text": s.text} for s in segments]
    meta = {"provider": "whisper-local", "model": f"faster-whisper-{size}", "mode": "transcribe",
            "language_code": info.language, "language_probability": round(info.language_probability, 3),
            "diarized": False}
    return _finish(normalise_chunks(rows), "stt:whisper-local"), meta
