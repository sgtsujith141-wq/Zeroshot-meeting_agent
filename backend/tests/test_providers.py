"""Provider adapters checked against the INSTALLED SDKs (offline, no keys, no network).

These tests prove the adapters call real SDK methods with real parameter names and
parse the SDK's own response types. They do NOT prove a live call works; that is
scripts/provider_smoke.py, which needs real keys. Stubs are used only for error paths.
"""

import inspect
import json
import typing

import pytest

from app.services.transcripts import normalise_chunks, parse_sarvam_output


# ---- Sarvam -----------------------------------------------------------------------

def test_sarvam_adapter_parameters_exist_in_sdk():
    from sarvamai.speech_to_text_job.client import SpeechToTextJobClient
    from sarvamai.speech_to_text_job.job import SpeechToTextJob
    params = set(inspect.signature(SpeechToTextJobClient.create_job).parameters)
    assert {"model", "mode", "with_diarization", "with_timestamps", "language_code", "num_speakers"} <= params
    assert "timeout" in inspect.signature(SpeechToTextJob.upload_files).parameters
    assert {"poll_interval", "timeout"} <= set(inspect.signature(SpeechToTextJob.wait_until_complete).parameters)
    assert "output_dir" in inspect.signature(SpeechToTextJob.download_outputs).parameters
    for m in ("start", "get_file_results"):
        assert hasattr(SpeechToTextJob, m)


def test_sarvam_configured_values_are_valid_sdk_literals():
    import sarvamai.types as T
    from app.config import Settings
    s = Settings()
    assert s.sarvam_model in typing.get_args(typing.get_args(T.SpeechToTextModel)[0])
    assert s.sarvam_mode in typing.get_args(typing.get_args(T.Mode)[0])
    langs = typing.get_args(typing.get_args(T.SpeechToTextLanguage)[0])
    assert {"unknown", "kn-IN", "hi-IN", "en-IN"} <= set(langs)


def test_parser_reads_the_sdk_diarized_types():
    from sarvamai.types import DiarizedEntry, DiarizedTranscript
    dt = DiarizedTranscript(entries=[
        DiarizedEntry(transcript="Rahul, API Friday olage", start_time_seconds=0.0, end_time_seconds=1.4, speaker_id="0"),
        DiarizedEntry(transcript="finish maadu.", start_time_seconds=1.6, end_time_seconds=2.5, speaker_id="0"),
        DiarizedEntry(transcript="Sari, naale kodthini.", start_time_seconds=2.9, end_time_seconds=4.1, speaker_id="1"),
    ])
    data = {"request_id": "r", "transcript": "...", "language_code": "kn-IN",
            "diarized_transcript": json.loads(dt.model_dump_json())}
    rows = parse_sarvam_output(data)
    assert [(r["speaker_label"], r["text"]) for r in rows] == [
        ("SPEAKER_00", "Rahul, API Friday olage finish maadu."),  # same-speaker fragments merged
        ("SPEAKER_01", "Sari, naale kodthini."),
    ]
    assert rows[0]["start_seconds"] == 0.0 and rows[0]["end_seconds"] == 2.5 and rows[1]["start_seconds"] == 2.9
    assert {r["source_type"] for r in rows} == {"stt:sarvam"}


def test_chunk_normalisation_orders_clamps_and_never_merges_across_speakers():
    rows = normalise_chunks([
        {"speaker": "A", "start": 5.0, "end": 4.0, "text": "late chunk"},      # inverted -> end = start
        {"speaker": "A", "start": -1.0, "end": 1.0, "text": "first"},           # negative -> 0
        {"speaker": "B", "start": 1.2, "end": 2.0, "text": "other speaker"},
        {"speaker": "A", "start": 2.1, "end": 3.0, "text": "not merged into B"},
        {"speaker": "A", "start": 3.1, "end": 3.5, "text": ""},                 # empty dropped
    ])
    assert [(r["speaker"], r["text"], r["start"]) for r in rows] == [
        ("A", "first", 0.0), ("B", "other speaker", 1.2), ("A", "not merged into B", 2.1), ("A", "late chunk", 5.0)]
    assert rows[-1]["end"] == 5.0


def test_sarvam_transcribe_flow_and_failure_with_stub(monkeypatch):
    from app.services.speech import sarvam
    calls = {}

    class Job:
        def upload_files(self, file_paths, timeout=60.0): calls["upload"] = (file_paths, timeout)  # noqa: E704
        def start(self): calls["start"] = True  # noqa: E704
        def wait_until_complete(self, poll_interval=5, timeout=600): calls["wait"] = timeout  # noqa: E704
        def get_file_results(self): return {"successful": [], "failed": [{"error_message": "bad audio"}]}  # noqa: E704

    class Client:
        def __init__(self, api_subscription_key): self.speech_to_text_job = self  # noqa: E704
        def create_job(self, **kw): calls["create"] = kw; return Job()  # noqa: E702,E704

    monkeypatch.setenv("SARVAM_API_KEY", "stub")
    from app.config import get_settings
    get_settings.cache_clear()
    import sarvamai
    monkeypatch.setattr(sarvamai, "SarvamAI", Client)
    with pytest.raises(sarvam.STTError, match="bad audio"):
        sarvam.transcribe(__import__("pathlib").Path("x.wav"))
    assert calls["create"]["with_diarization"] and calls["create"]["with_timestamps"]
    assert calls["create"]["model"] == "saaras:v4" and calls["create"]["mode"] == "codemix"
    assert calls["upload"][1] >= 600
    get_settings.cache_clear()


def test_sarvam_missing_key_is_reported_not_faked(monkeypatch):
    from app.services.speech import sarvam
    monkeypatch.setenv("SARVAM_API_KEY", "")
    from app.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(sarvam.STTUnavailable, match="SARVAM_API_KEY"):
        sarvam.transcribe(__import__("pathlib").Path("x.wav"))
    get_settings.cache_clear()


# ---- Gemini -----------------------------------------------------------------------

def test_gemini_config_accepts_our_inlined_schemas():
    from google.genai import types
    from app.services.llm_schemas import BaselineOut, GroundedAnswerOut, InterpretationOut, MinutesOut, inline_schema
    for model in (InterpretationOut, BaselineOut, MinutesOut, GroundedAnswerOut):
        cfg = types.GenerateContentConfig(system_instruction="s", response_mime_type="application/json",
                                          response_json_schema=inline_schema(model), temperature=0.0, seed=7)
        assert cfg.response_json_schema["type"] == "object"


@pytest.mark.parametrize("code,exc_name,msg", [
    (401, "LLMUnavailable", "invalid GEMINI_API_KEY"), (404, "LLMUnavailable", "not found"),
    (429, "LLMError", "quota"), (500, "LLMError", "server error"),
])
def test_gemini_errors_are_mapped(code, exc_name, msg):
    from google.genai import errors
    from app.services.llm import base
    from app.services.llm.gemini import GeminiClient
    c = GeminiClient("placeholder-not-a-key", "gemini-3.8-flash", 0.0, 7, 30)
    err = (errors.ClientError if code < 500 else errors.ServerError)(code, {"error": {"message": "x"}})

    class Models:
        def generate_content(self, **kw): raise err  # noqa: E704
    c._client = type("C", (), {"models": Models()})()
    with pytest.raises(getattr(base, exc_name), match=msg):
        c._raw("s", "u", {"type": "object"})


def test_gemini_empty_response_is_an_error():
    from app.services.llm.base import LLMError
    from app.services.llm.gemini import GeminiClient
    c = GeminiClient("placeholder-not-a-key", "gemini-3.8-flash", 0.0, 7, 30)
    resp = type("R", (), {"text": "", "candidates": [type("Cand", (), {"finish_reason": "SAFETY"})()],
                          "usage_metadata": None})()
    c._client = type("C", (), {"models": type("M", (), {"generate_content": lambda self, **kw: resp})()})()
    with pytest.raises(LLMError, match="SAFETY"):
        c._raw("s", "u", {"type": "object"})
