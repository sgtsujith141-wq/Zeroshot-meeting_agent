"""Transcript first: a recording can be transcribed on its own, read and corrected, then analysed
later; an analysis failure never loses the transcript, and retrying does not transcribe again.

The first test uses real local Whisper on a macOS text-to-speech clip in a WebM/Opus container
(what Chromium's MediaRecorder produces). It is skipped where those tools are missing (e.g. CI).
The others replace speech-to-text with recorded rows: they test the workflow, not a provider."""

from __future__ import annotations

import io
import shutil
import subprocess
import wave
from pathlib import Path

import pytest

from app.services import processing
from app.services.llm import LLMUnavailable
from app.services.speech import whisper_local

REAL_STT = (whisper_local.available() and shutil.which("say") and shutil.which("ffmpeg")
            and Path.home().joinpath(".cache/huggingface/hub/models--Systran--faster-whisper-small").exists())


def meeting(client) -> int:
    r = client.post("/api/meetings", json={"title": "Recorded check", "scheduled_at": "2026-10-23T10:00",
                                           "timezone": "Asia/Kolkata", "consent_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def silent_wav(seconds: float = 2.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)  # noqa: E702
        w.writeframes(b"\0\0" * int(16000 * seconds))
    return buf.getvalue()


ROWS = [{"seg_key": "s1", "speaker_label": "SPEAKER_00", "start_seconds": 0.0, "end_seconds": 3.0,
         "text": "Rahul, please finish the refund API by Thursday.", "source_type": "stt:whisper-local"}]
META = {"provider": "whisper-local", "model": "faster-whisper-small", "mode": "transcribe", "diarized": False}


@pytest.mark.skipif(not REAL_STT, reason="local Whisper model, macOS say or ffmpeg not available")
def test_a_browser_style_webm_recording_is_transcribed_on_its_own(client, llm, tmp_path):
    aiff, webm = tmp_path / "clip.aiff", tmp_path / "recording.webm"
    subprocess.run(["say", "-o", str(aiff), "Rahul, please finish the refund API by Thursday."], check=True, timeout=60)
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(aiff), "-c:a", "libopus", str(webm)],
                   check=True, timeout=60)
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", data={"transcribe_only": "true"},
                    files={"file": ("recording.webm", webm.read_bytes(), "audio/webm")})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["source_type"] == "audio"  # audio-only WebM is a recording, not a video
    assert m["processing_status"] == "transcribed" and m["stt_provider"] == "whisper-local"
    text = " ".join(s["text"] for s in m["segments"]).lower()
    assert "refund" in text and "thursday" in text
    assert llm.calls == [] and m["change_set"] is None  # nothing analysed yet
    assert [entry["step"] for entry in m["processing_log"]] == ["queue", "transcribe"]


def test_transcribe_only_stops_after_speech_to_text_and_analysis_runs_later(client, llm, monkeypatch):
    calls = []
    monkeypatch.setattr(processing.stt, "transcribe", lambda path: calls.append(path) or ([dict(r) for r in ROWS], META))
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", data={"transcribe_only": "1"},
                    files={"file": ("recording.wav", silent_wav(), "audio/wav")})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "transcribed" and m["change_set"] is None and len(calls) == 1
    # The organiser corrects a line before the analysis.
    r = client.patch(f"/api/meetings/{mid}/segments/s1", json={"text": "Rahul, please finish the refund API by Friday."})
    assert r.status_code == 200 and r.json()["revision"] == 2
    llm.push("interpret_events", {"events": [
        {"type": "PROPOSE", "task_key": "refund-api", "title": "Finish the refund API", "owner": "Rahul",
         "deadline_text": "by Friday", "strength": "firm", "segment_ids": ["s1"]}]})
    r = client.post(f"/api/meetings/{mid}/process", json={"steps": ["interpret", "minutes"]})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "ready_for_review" and m["change_set"] is not None
    assert len(calls) == 1  # not transcribed again
    assert m["segments"][0]["text"].endswith("by Friday.")  # the correction is what was analysed


def test_an_analysis_failure_keeps_the_transcript_and_retry_skips_transcription(client, llm, monkeypatch):
    calls = []
    monkeypatch.setattr(processing.stt, "transcribe", lambda path: calls.append(path) or ([dict(r) for r in ROWS], META))

    def down(*a, **k):
        raise LLMUnavailable("Ollama is not reachable")
    monkeypatch.setattr(processing, "get_llm", down)
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", files={"file": ("recording.wav", silent_wav(), "audio/wav")})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "failed" and m["processing_error"].startswith("interpret:")
    assert [s["text"] for s in m["segments"]] == [ROWS[0]["text"]]  # the transcript survived
    assert client.get(f"/api/meetings/{mid}/media-url").status_code == 200  # the recording is still playable
    monkeypatch.setattr(processing, "get_llm", lambda *a, **k: llm)
    llm.push("interpret_events", {"events": []})
    r = client.post(f"/api/meetings/{mid}/process", json={"steps": ["interpret", "minutes"]})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "ready_for_review" and len(calls) == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not available")
def test_a_video_with_sound_is_stored_as_video_and_transcribed_from_its_audio(client, llm, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(processing.stt, "transcribe", lambda path: calls.append(Path(path)) or ([dict(r) for r in ROWS], META))
    mp4 = tmp_path / "meeting.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", str(mp4)],
                   check=True, timeout=60)
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", data={"transcribe_only": "true"},
                    files={"file": ("meeting.mp4", mp4.read_bytes(), "video/mp4")})
    assert r.status_code == 200, r.text
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["source_type"] == "video" and m["processing_status"] == "transcribed"
    assert len(calls) == 1 and calls[0].suffix == ".wav"  # speech-to-text got the extracted audio track


def test_a_video_without_sound_is_refused(client, tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not available")
    mp4 = tmp_path / "silent.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1",
                    "-c:v", "mpeg4", str(mp4)], check=True, timeout=60)
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", files={"file": ("silent.mp4", mp4.read_bytes(), "video/mp4")})
    assert r.status_code == 422 and "no audio stream" in r.json()["detail"]


def test_a_transcription_failure_keeps_the_recording_and_try_again_transcribes_it(client, llm, monkeypatch):
    from app.services.speech.sarvam import STTError
    attempts = []

    def flaky(path):
        attempts.append(path)
        if len(attempts) == 1:
            raise STTError("provider timed out")
        return [dict(r) for r in ROWS], META
    monkeypatch.setattr(processing.stt, "transcribe", flaky)
    mid = meeting(client)
    r = client.post(f"/api/meetings/{mid}/upload", data={"transcribe_only": "1"},
                    files={"file": ("recording.wav", silent_wav(), "audio/wav")})
    assert r.status_code == 200
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "failed" and m["processing_error"].startswith("transcribe:") and m["segments"] == []
    assert client.get(f"/api/meetings/{mid}/media-url").status_code == 200  # the recording is kept
    r = client.post(f"/api/meetings/{mid}/process", json={"steps": ["transcribe"]})  # "Try transcription again"
    assert r.status_code == 200
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "transcribed" and len(m["segments"]) == 1 and len(attempts) == 2
