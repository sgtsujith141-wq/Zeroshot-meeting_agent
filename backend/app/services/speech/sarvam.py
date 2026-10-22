"""Sarvam batch speech-to-text with diarization (sarvamai SDK).

Follows the documented flow: create_job -> upload_files -> start ->
wait_until_complete -> get_file_results -> download_outputs. Timestamps are
chunk/phrase level, not word level. Reported as verified only after a live run.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from ...config import get_settings
from ..transcripts import parse_sarvam_output


class STTUnavailable(RuntimeError):
    pass


class STTError(RuntimeError):
    pass


def transcribe(audio_path: Path, *, num_speakers: int | None = None, mode: str | None = None,
               language_code: str | None = None, timeout: int = 1800) -> tuple[list[dict], dict]:
    s = get_settings()
    if not s.sarvam_api_key:
        raise STTUnavailable("SARVAM_API_KEY is not set; import a transcript instead")
    from sarvamai import SarvamAI

    client = SarvamAI(api_subscription_key=s.sarvam_api_key)
    params = {"model": s.sarvam_model, "mode": mode or s.sarvam_mode, "with_diarization": True}
    lang = language_code or s.sarvam_language_code
    if lang and lang != "unknown":
        params["language_code"] = lang
    if num_speakers:
        params["num_speakers"] = int(num_speakers)
    try:
        job = client.speech_to_text_job.create_job(**params)
        job.upload_files(file_paths=[str(audio_path)])
        job.start()
        job.wait_until_complete(poll_interval=5, timeout=timeout)
        results = job.get_file_results()
    except Exception as exc:
        raise STTError(f"Sarvam batch job failed: {type(exc).__name__}: {str(exc)[:300]}") from exc
    if results.get("failed"):
        raise STTError("Sarvam failed: " + "; ".join(f.get("error_message", "?") for f in results["failed"]))
    with tempfile.TemporaryDirectory() as tmp:
        job.download_outputs(output_dir=tmp)
        outputs = sorted(Path(tmp).glob("*.json"))
        if not outputs:
            raise STTError("Sarvam returned no output files")
        data = json.loads(outputs[0].read_text())
    meta = {"provider": "sarvam", "model": s.sarvam_model, "mode": params["mode"],
            "language_code": data.get("language_code"), "request_id": data.get("request_id"),
            "diarized": bool((data.get("diarized_transcript") or {}).get("entries"))}
    return parse_sarvam_output(data), meta
