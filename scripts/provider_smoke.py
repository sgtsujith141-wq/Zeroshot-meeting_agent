#!/usr/bin/env python3
"""Live provider smoke tests. Real requests only; nothing is simulated.

  backend/.venv/bin/python scripts/provider_smoke.py                    # Gemini + Ollama
  backend/.venv/bin/python scripts/provider_smoke.py --audio path.m4a   # + speech-to-text

Each check prints PASS, FAIL (with the reason) or SKIP (with the missing variable).
Keys are read from the environment / .env and never printed. A JSON summary is
written to evaluation/results/<UTC>_provider_smoke.json.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.services.identity import SpeakerDirectory  # noqa: E402
from app.services.llm import LLMError, get_llm  # noqa: E402
from app.services.pipelines import candidate_items, run_candidate  # noqa: E402
from app.services.reconcile import Segment  # noqa: E402

# Starter-kit fixture T02 (synthetic): one reassignment within the meeting.
SEGMENTS = [Segment("s1", "Lead", 0, "Priya will handle login testing."),
            Segment("s2", "Lead", 15, "Correction, Samiksha will handle login testing. Priya will write the API docs."),
            Segment("s3", "Samiksha", 30, "Okay, I will test login.")]
EXPECTED = {"login": "samiksha", "doc": "priya"}


def llm_check(provider: str) -> dict:
    s = get_settings()
    if provider == "gemini" and not s.gemini_api_key:
        return {"status": "SKIP", "reason": "GEMINI_API_KEY is not set"}
    try:
        llm = get_llm(provider=provider)
        t0 = time.monotonic()
        run = run_candidate(llm, datetime(2026, 10, 19, 10, tzinfo=timezone.utc), "Asia/Kolkata", SEGMENTS, [],
                            SpeakerDirectory())
        items = candidate_items(run.result)
        owners = {k: next((i["owner"] or "").lower() for i in items if k in (i["title"] or "").lower())
                  for k in EXPECTED if any(k in (i["title"] or "").lower() for i in items)}
        ok = owners == EXPECTED
        out = {"status": "PASS" if ok else "FAIL", "provider": llm.provider, "model": llm.model,
               "latency_s": round(time.monotonic() - t0, 1), "events": len(run.interpretation.events),
               "schema_attempts": run.call.attempts, "owners_found": owners, "expected": EXPECTED}
        if provider == "gemini":
            from app.services.llm.gemini import GeminiClient
            listed = GeminiClient(s.gemini_api_key, s.gemini_model, 0, 7, 60).list_models()
            out["model_listed_by_account"] = any(m.endswith(s.gemini_model) for m in listed)
        return out
    except LLMError as exc:
        return {"status": "FAIL", "reason": str(exc)[:300]}


def stt_check(audio: Path, provider: str) -> dict:
    from app.services import media
    from app.services.speech import sarvam, stt, whisper_local
    if provider == "sarvam" and not get_settings().sarvam_api_key:
        return {"status": "SKIP", "reason": "SARVAM_API_KEY is not set"}
    if provider == "whisper" and not whisper_local.available():
        return {"status": "SKIP", "reason": "local Whisper not installed (uv sync --group local-stt)"}
    try:
        info = media.probe(audio)
        wav = media.normalise_audio(audio)
        t0 = time.monotonic()
        rows, meta = (sarvam.transcribe if provider == "sarvam" else whisper_local.transcribe)(wav)
        speakers = sorted({r["speaker_label"] for r in rows})
        return {"status": "PASS" if rows else "FAIL", **meta, "audio_seconds": round(info["duration_seconds"], 1),
                "latency_s": round(time.monotonic() - t0, 1), "segments": len(rows), "speakers": speakers,
                "timestamps_present": all(r["end_seconds"] is not None for r in rows),
                "first_segment": rows[0]["text"][:120] if rows else None}
    except stt.STTUnavailable as exc:
        return {"status": "SKIP", "reason": str(exc)}
    except Exception as exc:  # report, never fake
        return {"status": "FAIL", "reason": f"{type(exc).__name__}: {str(exc)[:300]}"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", type=Path, help="a short consented recording to transcribe")
    args = ap.parse_args()
    report = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "gemini": llm_check("gemini"), "ollama": llm_check("ollama")}
    if args.audio:
        report["sarvam_stt"] = stt_check(args.audio, "sarvam")
        report["whisper_local_stt"] = stt_check(args.audio, "whisper")
    for k, v in report.items():
        if isinstance(v, dict):
            print(f"{k:15s} {v['status']:5s} {json.dumps({x: y for x, y in v.items() if x != 'status'})}")
    out = ROOT / "evaluation" / "results" / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}_provider_smoke.json"
    out.write_text(json.dumps(report, indent=2))
    print(f"wrote {out.relative_to(ROOT)}")
    return 0 if all(v.get("status") != "FAIL" for v in report.values() if isinstance(v, dict)) else 1


if __name__ == "__main__":
    sys.exit(main())
