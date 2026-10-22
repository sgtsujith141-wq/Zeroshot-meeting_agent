"""Real local transcription (faster-whisper) on a macOS text-to-speech clip.
Skipped where faster-whisper, the cached model, macOS `say` or FFmpeg are unavailable (e.g. CI).
Synthetic speech: this checks the audio pipeline, not real-meeting accuracy."""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import media
from app.services.speech import whisper_local

pytestmark = pytest.mark.skipif(
    not (whisper_local.available() and shutil.which("say") and shutil.which("ffmpeg")
         and Path.home().joinpath(".cache/huggingface/hub/models--Systran--faster-whisper-small").exists()),
    reason="local Whisper model, macOS say or ffmpeg not available")


def test_local_whisper_transcribes_real_audio_through_the_media_pipeline(tmp_path):
    aiff = tmp_path / "clip.aiff"
    subprocess.run(["say", "-v", "Rishi", "-o", str(aiff), "Kavya, please finish the login screen by Friday."],
                   check=True, timeout=60)
    wav = media.normalise_audio(aiff)
    rows, meta = whisper_local.transcribe(wav)
    text = " ".join(r["text"] for r in rows).lower()
    assert meta["provider"] == "whisper-local" and meta["diarized"] is False
    assert "login" in text and "friday" in text
    assert all(r["end_seconds"] is not None and r["end_seconds"] >= r["start_seconds"] for r in rows)
    assert {r["source_type"] for r in rows} == {"stt:whisper-local"}


def test_wav_reader_rejects_non_normalised_audio(tmp_path):
    aiff = tmp_path / "x.aiff"
    subprocess.run(["say", "-o", str(aiff), "hello"], check=True, timeout=60)
    stereo = tmp_path / "x.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(aiff), "-ac", "2", "-ar", "44100",
                    str(stereo)], check=True, timeout=60)
    with pytest.raises(ValueError, match="16 kHz mono"):
        whisper_local._pcm16_wav(stereo)
