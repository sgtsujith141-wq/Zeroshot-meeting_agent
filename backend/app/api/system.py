from __future__ import annotations

import json
import shutil
import subprocess
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select

from ..auth import require_organizer
from ..config import REPO_DIR, get_settings
from ..db import get_session
from ..models import AuditEvent, LLMRun, Meeting
from ..schemas import EvalRunRequest
from ..services.audit import record
from ..services.clock import is_simulated, now_utc
from ..services.llm import LLMError, LLMUnavailable, get_llm, llm_status

router = APIRouter(prefix="/api", tags=["system"])
RESULTS_DIR = REPO_DIR / "evaluation" / "results"
_last_smoke: dict = {}


class _Smoke(BaseModel):
    ok: bool
    echo: str


@router.get("/health")
def health(request: Request, session: Session = Depends(get_session)) -> dict:
    s = get_settings()
    session.execute(text("SELECT 1"))
    worker = getattr(request.app.state, "reminder_worker", None)
    return {"status": "ok", "time_utc": now_utc().isoformat(), "clock": "simulated" if is_simulated() else "real",
            "auth_configured": bool(s.organizer_token),
            "reminder_worker": {"running": bool(worker and worker.running),
                                "last_run_utc": worker.last_run.isoformat() if worker and worker.last_run else None,
                                "interval_seconds": s.reminder_poll_seconds}}


@router.get("/diagnostics")
def diagnostics(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    s = get_settings()
    sarvam_ok = session.exec(select(Meeting).where(Meeting.stt_provider == "sarvam",
                                                   Meeting.processing_status == "ready_for_review")).first()
    runs = session.exec(select(LLMRun).order_by(LLMRun.id.desc())).all()
    by_model: dict[str, dict] = {}
    for r in runs:
        k = f"{r.provider}/{r.model}"
        b = by_model.setdefault(k, {"calls": 0, "errors": 0, "latency_ms": []})
        b["calls"] += 1
        b["errors"] += 1 if r.error else 0
        b["latency_ms"].append(r.latency_ms)
    for b in by_model.values():
        lat = sorted(b.pop("latency_ms"))
        b["median_latency_ms"] = lat[len(lat) // 2] if lat else None
    return {
        "llm": {**llm_status(s), "last_live_smoke_test": _last_smoke or None, "app_calls_by_model": by_model},
        "speech": {"provider": "sarvam", "model": s.sarvam_model, "mode": s.sarvam_mode,
                   "api_key_present": bool(s.sarvam_api_key),
                   "verified_by_processed_meeting": bool(sarvam_ok),
                   "ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe"))},
        "outbound": {"smtp_configured": s.smtp_configured,
                     "external_calendar_api": False,
                     "note": "No third-party calendar API is integrated; .ics is an export."},
        "clock": "simulated" if is_simulated() else "real",
        "evaluation_runs": _list_results(),
    }


@router.post("/diagnostics/llm-smoke")
def llm_smoke(actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    """A real, tiny structured request to the configured provider."""
    global _last_smoke
    try:
        llm = get_llm()
        out, call = llm.generate_json("Return JSON only.", 'Reply with ok=true and echo="ps53".', _Smoke,
                                      purpose="smoke_test")
        _last_smoke = {"ok": out.ok and out.echo == "ps53", "provider": call.provider, "model": call.model,
                       "latency_ms": call.latency_ms, "at": now_utc().isoformat()}
    except (LLMUnavailable, LLMError) as exc:
        _last_smoke = {"ok": False, "error": str(exc)[:300], "at": now_utc().isoformat()}
    record(session, actor, "llm", "smoke", "test", after=_last_smoke)
    session.commit()
    return _last_smoke


def _list_results() -> list[dict]:
    out = []
    for p in sorted(RESULTS_DIR.glob("*.json"), reverse=True):
        try:
            d = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if "aggregate" not in d:
            continue
        out.append({"run_id": d["meta"]["run_id"], "meta": d["meta"], "aggregate": d["aggregate"]})
    return out


@router.get("/evaluation/results")
def evaluation_results(_: str = Depends(require_organizer)) -> list[dict]:
    return _list_results()


@router.get("/evaluation/results/{run_id}")
def evaluation_result(run_id: str, _: str = Depends(require_organizer)) -> dict:
    path = (RESULTS_DIR / f"{run_id}.json").resolve()
    if RESULTS_DIR.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "result not found")
    return json.loads(path.read_text())


@router.post("/evaluation/run")
def run_evaluation(body: EvalRunRequest, actor: str = Depends(require_organizer),
                   session: Session = Depends(get_session)) -> dict:
    """Starts evaluation/run_eval.py as a separate process (it may take minutes on CPU)."""
    args = [sys.executable, str(REPO_DIR / "evaluation" / "run_eval.py")]
    if body.provider:
        args += ["--provider", body.provider]
    if body.model:
        args += ["--model", body.model]
    if body.cases:
        args += ["--cases", ",".join(c for c in body.cases if c.replace("_", "").isalnum())]
    log = RESULTS_DIR / "last_run.log"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with log.open("w") as fh:
        proc = subprocess.Popen(args, stdout=fh, stderr=subprocess.STDOUT, cwd=str(REPO_DIR))  # noqa: S603
    record(session, actor, "evaluation", proc.pid, "start", after={"args": args[2:]})
    session.commit()
    return {"started": True, "pid": proc.pid, "log": str(log.relative_to(REPO_DIR))}


@router.get("/audit")
def audit(limit: int = 100, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(max(limit, 1), 500))).all()
    return [r.model_dump(mode="json") for r in rows]
