"""Meeting processing: (audio -> STT) -> segments -> LLM events -> minutes -> change set.

Runs in a single background worker (local CPU models are slow; one job at a
time keeps the server responsive). A failing step records its error and keeps
earlier good results; nothing is deleted on failure.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, delete, select

from ..db import get_engine
from ..models import (
    CommitmentEvent, Decision, LLMRun, Meeting, OpenQuestion, Participant, TranscriptSegment,
)
from . import changesets, media, memory
from .clock import now_utc
from .identity import is_anonymous_label
from .similarity import title_similarity
from .llm import LLMError, LLMOutputError, LLMUnavailable, get_llm
from .llm_schemas import MinutesOut
from .pipelines import interpret
from .prompts import MINUTES_SYSTEM, build_user_prompt
from .speech import sarvam

log = logging.getLogger("processing")
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="meeting-job")
BUSY = ("queued", "transcribing", "interpreting", "writing_minutes")


def _log(meeting: Meeting, step: str, status: str, detail: str | None = None) -> None:
    meeting.processing_log = list(meeting.processing_log or []) + [
        {"at": now_utc().isoformat(timespec="seconds"), "step": step, "status": status, "detail": detail}]


def store_segments(session: Session, meeting: Meeting, rows: list[dict]) -> int:
    """Replace the meeting's transcript (only allowed before any change set was applied)."""
    session.exec(delete(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting.id))
    memory.remove_meeting(session, meeting.id)
    labels: list[str] = []
    for i, r in enumerate(rows):
        seg = TranscriptSegment(meeting_id=meeting.id, seg_key=r["seg_key"], order_index=i,
                                speaker_label=r["speaker_label"], start_seconds=r["start_seconds"],
                                end_seconds=r["end_seconds"], text=r["text"], source_type=r["source_type"])
        session.add(seg)
        session.flush()
        memory.index_segment(session, seg)
        if r["speaker_label"] not in labels:
            labels.append(r["speaker_label"])
    existing = {p.speaker_label for p in session.exec(select(Participant).where(Participant.meeting_id == meeting.id))}
    for label in labels:
        if label not in existing:
            # Attributed names from an imported transcript are kept as display names but
            # NOT marked confirmed; anonymous diarization labels get no name at all.
            session.add(Participant(meeting_id=meeting.id, speaker_label=label,
                                    display_name=None if is_anonymous_label(label) else label,
                                    confirmed_identity=False))
    return len(rows)


def _save_run(session: Session, meeting_id: int, call) -> LLMRun:  # noqa: ANN001
    run = LLMRun(meeting_id=meeting_id, purpose=call.purpose, provider=call.provider, model=call.model,
                 temperature=call.temperature, seed=call.seed, latency_ms=call.latency_ms,
                 attempts=call.attempts, usage=call.usage, raw_text=call.raw_text, error=call.error)
    session.add(run)
    session.flush()
    return run


def _context(session: Session, meeting: Meeting):  # noqa: ANN202
    segments = changesets.meeting_segments(session, meeting.id)
    ledger, _ = changesets.active_ledger(session)
    directory = changesets.speaker_directory(session, meeting.id)
    return datetime.fromisoformat(meeting.scheduled_at), segments, ledger, directory


def step_transcribe(session: Session, meeting: Meeting) -> None:
    if meeting.source_type not in ("audio", "video") or not meeting.file_path:
        return
    meeting.processing_status = "transcribing"
    session.add(meeting)
    session.commit()
    wav = media.normalise_audio(Path(meeting.file_path))
    rows, meta = sarvam.transcribe(wav)
    store_segments(session, meeting, rows)
    meeting.stt_provider, meeting.stt_model = meta["provider"], meta["model"]
    _log(meeting, "transcribe", "ok", f"{len(rows)} segments; diarized={meta['diarized']}; "
                                      f"language={meta.get('language_code')}")


def step_interpret(session: Session, meeting: Meeting) -> None:
    meeting.processing_status = "interpreting"
    session.add(meeting)
    session.commit()
    llm = get_llm()
    meeting_dt, segments, ledger, directory = _context(session, meeting)
    try:
        interp, call = interpret(llm, meeting_dt, meeting.timezone, segments, ledger, directory)
    except LLMOutputError as exc:
        _save_run(session, meeting.id, exc.call)
        session.commit()
        raise
    run = _save_run(session, meeting.id, call)
    # Replace events only after a successful call (previous good results survive failures).
    session.exec(delete(CommitmentEvent).where(CommitmentEvent.meeting_id == meeting.id))
    valid_ids = {s.id for s in segments}
    for n, ev in enumerate(interp.events):
        bad = [s for s in ev.segment_ids if s not in valid_ids]
        session.add(CommitmentEvent(
            meeting_id=meeting.id, llm_run_id=run.id, seq=n, type=ev.type.value, task_key=ev.task_key,
            payload=ev.model_dump(mode="json"), segment_ids=ev.segment_ids,
            interpretation_status="rejected" if len(bad) == len(ev.segment_ids) else "valid",
            rejection_reason=f"nonexistent segments {bad}" if bad else None))
    _log(meeting, "interpret", "ok", f"{len(interp.events)} events from {call.provider}/{call.model} "
                                     f"in {call.latency_ms} ms")


def step_minutes(session: Session, meeting: Meeting) -> None:
    meeting.processing_status = "writing_minutes"
    session.add(meeting)
    session.commit()
    llm = get_llm()
    meeting_dt, segments, ledger, directory = _context(session, meeting)
    user = build_user_prompt(meeting_dt, meeting.timezone, segments, [], directory)
    try:
        out, call = llm.generate_json(MINUTES_SYSTEM, user, MinutesOut, purpose="minutes")
    except LLMOutputError as exc:
        _save_run(session, meeting.id, exc.call)
        session.commit()
        raise
    _save_run(session, meeting.id, call)
    valid = {s.id for s in segments}

    def ev(ids: list[str]) -> list[str]:
        return [i for i in ids if i in valid]

    dropped = 0
    topics = []
    for t in out.discussion:
        if ev(t.segment_ids):
            topics.append({"topic": t.topic, "summary": t.summary, "segment_ids": ev(t.segment_ids)})
        else:
            dropped += 1
    session.exec(delete(Decision).where(Decision.meeting_id == meeting.id, Decision.approval_status == "proposed"))
    work = work_item_evidence(session, meeting.id, ledger)
    reclassified = []
    for d in out.decisions:
        if not ev(d.segment_ids):
            dropped += 1
        elif (why := assignment_like(d.text, ev(d.segment_ids), work)):
            reclassified.append({"text": d.text, "segment_ids": ev(d.segment_ids), "reason": why})
        else:
            session.add(Decision(meeting_id=meeting.id, text=d.text, rationale=d.rationale,
                                 evidence_segment_ids=ev(d.segment_ids), source="minutes"))
    session.exec(delete(OpenQuestion).where(OpenQuestion.meeting_id == meeting.id))
    for q in out.open_questions:
        if ev(q.segment_ids):
            oq = OpenQuestion(meeting_id=meeting.id, text=q.text, evidence_segment_ids=ev(q.segment_ids))
            session.add(oq)
            session.flush()
            memory.index_question(session, oq)
        else:
            dropped += 1
    meeting.minutes = {"summary": out.summary, "discussion": topics,
                       "generated_by": f"{call.provider}/{call.model}", "dropped_unsupported_items": dropped,
                       "reclassified_as_actions": reclassified,
                       "generated_at": now_utc().isoformat(timespec="seconds")}
    _log(meeting, "minutes", "ok", f"{len(out.decisions) - len(reclassified)} decisions "
                                   f"({len(reclassified)} assignment-like moved to actions), "
                                   f"{len(out.open_questions)} questions; {dropped} items without valid evidence dropped")


WORK_EVENTS = ("PROPOSE", "CONFIRM", "REASSIGN", "CHANGE_DEADLINE", "REPORT_COMPLETE")


def work_item_evidence(session: Session, meeting_id: int, ledger) -> dict[str, list[tuple[str, str]]]:  # noqa: ANN001
    """segment key -> [(owner, title)] of the work-item events that cite it."""
    titles = {t.task_id.lower(): t.title for t in ledger}
    out: dict[str, list[tuple[str, str]]] = {}
    for e in session.exec(select(CommitmentEvent).where(CommitmentEvent.meeting_id == meeting_id)).all():
        if e.type not in WORK_EVENTS:
            continue
        p = e.payload
        title = p.get("title") or titles.get((e.task_key or "").lower()) or (e.task_key or "").replace("-", " ")
        for sid in e.segment_ids:
            out.setdefault(sid, []).append(((p.get("owner") or ""), title))
    return out


def assignment_like(text: str, seg_ids: list[str], work: dict[str, list[tuple[str, str]]]) -> str | None:
    """A minutes 'decision' that only restates a task assignment/status already captured as an
    action: every cited segment carries a work-item event, and the text names that item's owner
    or matches its title. Returns the reason, or None if it is a genuine decision."""
    if not seg_ids or not all(s in work for s in seg_ids):
        return None
    low = text.lower()
    for sid in seg_ids:
        for owner, title in work[sid]:
            if owner and owner.upper() != "SELF" and re.search(rf"\b{re.escape(owner.lower())}\b", low):
                return f"names the owner ({owner}) of an action from the same lines"
            if title and title_similarity(text, title) >= 0.5:
                return f"restates the action “{title}” from the same lines"
    return None


def run_pipeline(meeting_id: int, steps: tuple[str, ...] = ("transcribe", "interpret", "minutes")) -> None:
    with Session(get_engine(), expire_on_commit=False) as session:
        meeting = session.get(Meeting, meeting_id)
        if meeting is None:
            return
        current = "start"
        try:
            for step in steps:
                current = step
                {"transcribe": step_transcribe, "interpret": step_interpret, "minutes": step_minutes}[step](
                    session, meeting)
                session.add(meeting)
                session.commit()
            changesets.create_or_refresh(session, meeting.id, actor="system")
            meeting.processing_status, meeting.processing_error = "ready_for_review", None
            _log(meeting, "changeset", "ok")
        except (LLMUnavailable, sarvam.STTUnavailable) as exc:
            session.rollback()
            meeting = session.get(Meeting, meeting_id)
            meeting.processing_status, meeting.processing_error = "failed", f"{current}: {exc}"
            _log(meeting, current, "unavailable", str(exc))
        except (LLMError, sarvam.STTError, media.MediaError, ValueError) as exc:
            session.rollback()
            meeting = session.get(Meeting, meeting_id)
            meeting.processing_status, meeting.processing_error = "failed", f"{current}: {str(exc)[:500]}"
            _log(meeting, current, "error", str(exc)[:500])
        except Exception as exc:  # unexpected: record, never crash the worker
            log.exception("processing failed")
            session.rollback()
            meeting = session.get(Meeting, meeting_id)
            meeting.processing_status = "failed"
            meeting.processing_error = f"{current}: internal error {type(exc).__name__}"
            _log(meeting, current, "error", type(exc).__name__)
        session.add(meeting)
        session.commit()


def enqueue(session: Session, meeting: Meeting, steps: tuple[str, ...]) -> None:
    meeting.processing_status, meeting.processing_error = "queued", None
    _log(meeting, "queue", "ok", ",".join(steps))
    session.add(meeting)
    session.commit()
    _executor.submit(run_pipeline, meeting.id, steps)


def recover_interrupted(session: Session) -> int:
    n = 0
    for m in session.exec(select(Meeting).where(Meeting.processing_status.in_(BUSY))).all():
        m.processing_status = "failed"
        m.processing_error = "interrupted: the backend restarted while this meeting was processing"
        _log(m, "recover", "error", m.processing_error)
        session.add(m)
        n += 1
    session.commit()
    return n
