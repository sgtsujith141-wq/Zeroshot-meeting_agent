from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, delete, select

from ..auth import require_organizer, sign_media, verify_media
from ..config import get_settings
from ..db import get_session
from ..models import (
    ChangeSet, CommitmentEvent, Decision, LLMRun, Meeting, OpenQuestion, Participant, SummaryShare, Task,
    TranscriptSegment,
)
from ..schemas import MeetingCreate, ParticipantUpdate, ProcessRequest, SegmentUpdate
from ..services import changesets, media, memory, processing
from ..services.audit import record
from ..services.clock import now_utc
from ..services.identity import is_anonymous_label
from ..services.transcripts import TranscriptError, parse_transcript

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _meeting(session: Session, meeting_id: int) -> Meeting:
    m = session.get(Meeting, meeting_id)
    if m is None:
        raise HTTPException(404, "meeting not found")
    return m


def meeting_summary(session: Session, m: Meeting) -> dict:
    cs = session.exec(select(ChangeSet).where(ChangeSet.meeting_id == m.id).order_by(ChangeSet.id.desc())).first()
    n_seg = len(session.exec(select(TranscriptSegment.id).where(TranscriptSegment.meeting_id == m.id)).all())
    return {"id": m.id, "title": m.title, "scheduled_at": m.scheduled_at, "timezone": m.timezone,
            "organiser": m.organiser, "consent_confirmed": m.consent_confirmed, "source_type": m.source_type,
            "file_name": m.file_name, "duration_seconds": m.duration_seconds,
            "processing_status": m.processing_status, "processing_error": m.processing_error,
            "stt_provider": m.stt_provider, "segments": n_seg,
            "change_set": {"id": cs.id, "state": cs.state} if cs else None,
            "created_at": m.created_at.isoformat()}


@router.post("")
def create_meeting(body: MeetingCreate, actor: str = Depends(require_organizer),
                   session: Session = Depends(get_session)) -> dict:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    dt = datetime.fromisoformat(body.scheduled_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(body.timezone))
    m = Meeting(title=body.title.strip(), scheduled_at=dt.isoformat(), timezone=body.timezone, organiser=actor,
                consent_confirmed=True, consent_confirmed_at=now_utc(),
                consent_statement=body.consent_statement or "Organiser confirmed all participants consented "
                "to recording and processing, including by third-party AI providers.",
                language_hint=body.language_hint)
    session.add(m)
    session.flush()
    record(session, actor, "meeting", m.id, "create", after={"consent_confirmed": True})
    session.commit()
    return meeting_summary(session, m)


@router.get("")
def list_meetings(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    return [meeting_summary(session, m) for m in
            session.exec(select(Meeting).order_by(Meeting.scheduled_at.desc())).all()]


@router.get("/{meeting_id}")
def get_meeting(meeting_id: int, _: str = Depends(require_organizer),
                session: Session = Depends(get_session)) -> dict:
    m = _meeting(session, meeting_id)
    segs = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
                        .order_by(TranscriptSegment.order_index)).all()
    parts = session.exec(select(Participant).where(Participant.meeting_id == m.id)).all()
    events = session.exec(select(CommitmentEvent).where(CommitmentEvent.meeting_id == m.id)
                          .order_by(CommitmentEvent.seq)).all()
    runs = session.exec(select(LLMRun).where(LLMRun.meeting_id == m.id).order_by(LLMRun.id)).all()
    decisions = session.exec(select(Decision).where(Decision.meeting_id == m.id)).all()
    questions = session.exec(select(OpenQuestion).where(OpenQuestion.meeting_id == m.id)).all()
    return {
        **meeting_summary(session, m),
        "consent_statement": m.consent_statement, "language_hint": m.language_hint,
        "processing_log": m.processing_log, "minutes": m.minutes,
        "participants": [{"speaker_label": p.speaker_label, "display_name": p.display_name,
                          "confirmed_identity": p.confirmed_identity,
                          "anonymous_label": is_anonymous_label(p.speaker_label)} for p in parts],
        "segments": [{"seg_key": s.seg_key, "speaker_label": s.speaker_label, "start_seconds": s.start_seconds,
                      "end_seconds": s.end_seconds, "text": s.text, "revision": s.revision,
                      "source_type": s.source_type} for s in segs],
        "decisions": [{"id": d.id, "text": d.text, "rationale": d.rationale,
                       "evidence_segment_ids": d.evidence_segment_ids, "approval_status": d.approval_status}
                      for d in decisions],
        "open_questions": [{"id": q.id, "text": q.text, "evidence_segment_ids": q.evidence_segment_ids,
                            "status": q.status} for q in questions],
        "events": [{"seq": e.seq, "type": e.type, "task_key": e.task_key, "payload": e.payload,
                    "segment_ids": e.segment_ids, "interpretation_status": e.interpretation_status,
                    "rejection_reason": e.rejection_reason} for e in events],
        "llm_runs": [{"id": r.id, "purpose": r.purpose, "provider": r.provider, "model": r.model,
                      "temperature": r.temperature, "seed": r.seed, "latency_ms": r.latency_ms,
                      "attempts": r.attempts, "usage": r.usage, "error": r.error,
                      "created_at": r.created_at.isoformat()} for r in runs],
        "timestamp_granularity": "segment/phrase level (not word level)",
    }


@router.post("/{meeting_id}/upload")
async def upload(meeting_id: int, file: UploadFile = File(...), auto_process: bool = Form(True),
                 actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    m = _meeting(session, meeting_id)
    if not m.consent_confirmed:
        raise HTTPException(403, "consent has not been confirmed for this meeting")
    if m.processing_status in processing.BUSY:
        raise HTTPException(409, "meeting is currently processing")
    if session.exec(select(ChangeSet).where(ChangeSet.meeting_id == m.id, ChangeSet.state == "APPLIED")).first():
        raise HTTPException(409, "this meeting already has approved changes; create a new meeting instead")
    name = media.safe_display_name(file.filename or "upload")
    try:
        kind = media.classify(name)
    except media.MediaError as exc:
        raise HTTPException(415, str(exc)) from exc
    s = get_settings()
    limit = media.MAX_TRANSCRIPT_BYTES if kind == "transcript" else s.max_upload_mb * 1024 * 1024
    dest = media.storage_path(s.uploads_dir, m.id, name)
    size = 0
    with dest.open("wb") as fh:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"file exceeds {limit // (1024 * 1024)} MB limit")
            fh.write(chunk)
    m.file_name, m.file_size, m.source_type, m.file_mime = name, size, kind, file.content_type
    if kind == "transcript":
        try:
            rows = parse_transcript(name, dest.read_text(encoding="utf-8", errors="replace"))
        except TranscriptError as exc:
            dest.unlink(missing_ok=True)
            raise HTTPException(422, f"transcript rejected: {exc}") from exc
        dest.unlink(missing_ok=True)  # parsed segments are stored; the raw upload is not kept
        m.file_path = None
        processing.store_segments(session, m, rows)
        m.processing_status = "transcribed"
        steps = ("interpret", "minutes")
    else:
        try:
            info = media.probe(dest)
        except media.MediaError as exc:
            dest.unlink(missing_ok=True)
            raise HTTPException(422, f"media rejected: {exc}") from exc
        m.file_path, m.duration_seconds = str(dest), info["duration_seconds"]
        m.processing_status = "uploaded"
        steps = ("transcribe", "interpret", "minutes")
    record(session, actor, "meeting", m.id, "upload", after={"kind": kind, "size": size, "name": name})
    session.add(m)
    session.commit()
    if auto_process:
        processing.enqueue(session, m, steps)
    return meeting_summary(session, m)


@router.post("/{meeting_id}/process")
def process(meeting_id: int, body: ProcessRequest, actor: str = Depends(require_organizer),
            session: Session = Depends(get_session)) -> dict:
    m = _meeting(session, meeting_id)
    if m.processing_status in processing.BUSY:
        raise HTTPException(409, "meeting is already processing")
    steps = tuple(s for s in body.steps if s != "transcribe" or m.source_type in ("audio", "video"))
    if "transcribe" not in steps and not session.exec(
            select(TranscriptSegment.id).where(TranscriptSegment.meeting_id == m.id)).first():
        raise HTTPException(409, "no transcript yet: upload audio or a transcript first")
    record(session, actor, "meeting", m.id, "process", after={"steps": list(steps)})
    processing.enqueue(session, m, steps)
    return meeting_summary(session, m)


@router.put("/{meeting_id}/participants/{speaker_label}")
def update_participant(meeting_id: int, speaker_label: str, body: ParticipantUpdate,
                       actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    _meeting(session, meeting_id)
    p = session.exec(select(Participant).where(Participant.meeting_id == meeting_id,
                                               Participant.speaker_label == speaker_label)).first()
    if p is None:
        raise HTTPException(404, "speaker not found in this meeting")
    before = {"display_name": p.display_name, "confirmed": p.confirmed_identity}
    p.display_name = (body.display_name or "").strip() or None
    p.confirmed_identity = bool(p.display_name) and body.confirmed_identity
    session.add(p)
    record(session, actor, "participant", f"{meeting_id}:{speaker_label}", "map", before,
           {"display_name": p.display_name, "confirmed": p.confirmed_identity})
    cs = changesets.open_change_set(session, meeting_id)
    if cs:  # deterministic re-fold with the new identity; no LLM call
        changesets.create_or_refresh(session, meeting_id, actor)
    session.commit()
    return {"speaker_label": p.speaker_label, "display_name": p.display_name,
            "confirmed_identity": p.confirmed_identity, "change_set_recomputed": bool(cs)}


@router.patch("/{meeting_id}/segments/{seg_key}")
def correct_segment(meeting_id: int, seg_key: str, body: SegmentUpdate, actor: str = Depends(require_organizer),
                    session: Session = Depends(get_session)) -> dict:
    seg = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting_id,
                                                       TranscriptSegment.seg_key == seg_key)).first()
    if seg is None:
        raise HTTPException(404, "segment not found")
    before = {"text": seg.text, "revision": seg.revision}
    seg.text, seg.revision = body.text.strip(), seg.revision + 1
    session.add(seg)
    memory.index_segment(session, seg)
    record(session, actor, "segment", f"{meeting_id}:{seg_key}", "correct", before,
           {"text": seg.text, "revision": seg.revision})
    session.commit()
    return {"seg_key": seg.seg_key, "text": seg.text, "revision": seg.revision,
            "note": "re-run interpretation to re-extract commitments from the corrected text"}


@router.get("/{meeting_id}/media-url")
def media_url(meeting_id: int, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    m = _meeting(session, meeting_id)
    if not m.file_path:
        raise HTTPException(404, "no media stored for this meeting")
    sig, exp = sign_media(meeting_id)
    return {"url": f"/api/meetings/{meeting_id}/media?sig={sig}&exp={exp}", "expires": exp}


@router.get("/{meeting_id}/media")
def media_file(meeting_id: int, sig: str = Query(...), exp: int = Query(...),
               session: Session = Depends(get_session)) -> FileResponse:
    if not verify_media(meeting_id, sig, exp):
        raise HTTPException(403, "invalid or expired media link")
    m = _meeting(session, meeting_id)
    if not m.file_path:
        raise HTTPException(404, "no media stored")
    path = Path(m.file_path).resolve()
    if get_settings().uploads_dir.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "media unavailable")
    return FileResponse(path, media_type=m.file_mime or "application/octet-stream")


@router.delete("/{meeting_id}")
def delete_meeting(meeting_id: int, actor: str = Depends(require_organizer),
                   session: Session = Depends(get_session)) -> dict:
    m = _meeting(session, meeting_id)
    if m.processing_status in processing.BUSY:
        raise HTTPException(409, "meeting is processing")
    linked = session.exec(select(Task).where((Task.origin_meeting_id == m.id) | (Task.last_meeting_id == m.id))).all()
    if linked:
        raise HTTPException(409, "approved tasks reference this meeting: " + ", ".join(t.code for t in linked))
    for model in (CommitmentEvent, Decision, OpenQuestion, ChangeSet, SummaryShare, LLMRun, TranscriptSegment,
                  Participant):
        session.exec(delete(model).where(model.meeting_id == m.id))
    memory.remove_meeting(session, m.id)
    if m.file_path:
        Path(m.file_path).unlink(missing_ok=True)
        Path(m.file_path).with_suffix(".16k.wav").unlink(missing_ok=True)
    record(session, actor, "meeting", m.id, "delete", before={"title": m.title})
    session.delete(m)
    session.commit()
    return {"deleted": meeting_id}
