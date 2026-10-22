from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from sqlmodel import Session, select

from ..auth import require_organizer
from ..db import get_session
from ..models import Approval, CalendarEvent, Meeting, Notification, Reminder, SummaryShare, Task
from ..schemas import MemoryQuery, ReminderCreate, SummaryApprove
from ..services import agenda, calendar, memory, reminders, summary
from ..services.audit import record
from ..services.clock import is_simulated, now_utc

router = APIRouter(prefix="/api", tags=["follow-up"])


# ---- calendar ---------------------------------------------------------------

def _event_view(session: Session, e: CalendarEvent) -> dict:
    t = session.get(Task, e.task_id)
    return {**e.model_dump(mode="json"), "task_code": t.code if t else None, "task_status": t.status if t else None,
            "owner": t.owner if t else None,
            "sync_note": "in-app calendar; .ics is an export (no third-party calendar API is configured)"}


@router.get("/calendar")
def list_events(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    return [_event_view(session, e) for e in session.exec(select(CalendarEvent).order_by(CalendarEvent.date)).all()]


@router.get("/calendar.ics")
def export_ics(actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> Response:
    events = session.exec(select(CalendarEvent).order_by(CalendarEvent.date)).all()
    body = calendar.to_ics(session, events)
    for e in events:
        if e.sync_state == "local":
            e.sync_state = "exported"
            session.add(e)
    record(session, actor, "calendar", "all", "export_ics", after={"events": len(events)})
    session.commit()
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="ps53-tasks.ics"'})


@router.get("/tasks/{code}/event.ics")
def task_ics(code: str, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> Response:
    t = session.exec(select(Task).where(Task.code == code)).first()
    e = session.exec(select(CalendarEvent).where(CalendarEvent.task_id == t.id)).first() if t else None
    if e is None:
        raise HTTPException(404, "no calendar event for this task (no approved due date)")
    return Response(calendar.to_ics(session, [e]), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{code}.ics"'})


# ---- reminders & notifications -------------------------------------------------

def _reminder_view(session: Session, r: Reminder) -> dict:
    t = session.get(Task, r.task_id)
    local = r.scheduled_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(t.timezone)) if t else None
    return {**r.model_dump(mode="json"), "task_code": t.code if t else None,
            "scheduled_at_local": local.isoformat() if local else None}


@router.get("/reminders")
def list_reminders(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    return [_reminder_view(session, r) for r in session.exec(select(Reminder).order_by(Reminder.scheduled_at)).all()]


@router.post("/reminders")
def create_reminder(body: ReminderCreate, actor: str = Depends(require_organizer),
                    session: Session = Depends(get_session)) -> dict:
    t = session.exec(select(Task).where(Task.code == body.task_code)).first()
    if t is None:
        raise HTTPException(404, "task not found")
    dt = datetime.fromisoformat(body.scheduled_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(t.timezone))
    at = dt.astimezone(timezone.utc)
    if body.channel == "email" and not body.recipients:
        raise HTTPException(422, "email reminders need explicit recipients")
    r = Reminder(task_id=t.id, scheduled_at=at, channel=body.channel, recipients=body.recipients,
                 message=body.message or f"Reminder: {t.code} “{t.title}” is due {t.due_date or '(no date)'}.",
                 delivery_state="draft")
    session.add(r)
    session.flush()
    record(session, actor, "reminder", r.id, "draft", after={"channel": r.channel})
    session.commit()
    return _reminder_view(session, r)


@router.post("/reminders/{rid}/approve")
def approve_reminder(rid: int, actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    r = session.get(Reminder, rid)
    if r is None:
        raise HTTPException(404, "reminder not found")
    if r.delivery_state != "draft":
        return _reminder_view(session, r)  # idempotent
    snap = {"task_id": r.task_id, "scheduled_at": r.scheduled_at.isoformat(), "channel": r.channel,
            "recipients": r.recipients, "message": r.message}
    h = hashlib.sha256(repr(sorted(snap.items())).encode()).hexdigest()
    a = Approval(actor=actor, scope=f"reminder:{r.id}", snapshot_hash=h, snapshot=snap)
    session.add(a)
    session.flush()
    r.approval_id, r.delivery_state = a.id, "scheduled"
    session.add(r)
    record(session, actor, "reminder", r.id, "approve")
    session.commit()
    return _reminder_view(session, r)


@router.post("/reminders/{rid}/cancel")
def cancel_reminder(rid: int, actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    r = session.get(Reminder, rid)
    if r is None:
        raise HTTPException(404, "reminder not found")
    if r.delivery_state in ("draft", "scheduled"):
        r.delivery_state = "cancelled"
        session.add(r)
        record(session, actor, "reminder", r.id, "cancel")
        session.commit()
    return _reminder_view(session, r)


@router.post("/reminders/run-due")
def run_due(actor: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    """Deliver due reminders now using the real clock (same code path as the worker)."""
    delivered = reminders.deliver_due(session)
    return {"delivered_reminder_ids": delivered, "clock": "simulated" if is_simulated() else "real",
            "now_utc": now_utc().isoformat()}


@router.get("/notifications")
def notifications(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(Notification).order_by(Notification.created_at.desc())).all()
    return [n.model_dump(mode="json") for n in rows]


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    n = session.get(Notification, nid)
    if n is None:
        raise HTTPException(404, "notification not found")
    n.read = True
    session.add(n)
    session.commit()
    return n.model_dump(mode="json")


# ---- summary sharing ---------------------------------------------------------------

def _share_view(s: SummaryShare) -> dict:
    return {**s.model_dump(mode="json"), "content_hash": hashlib.sha256(s.content.encode()).hexdigest()}


@router.post("/meetings/{meeting_id}/summary")
def prepare_summary(meeting_id: int, actor: str = Depends(require_organizer),
                    session: Session = Depends(get_session)) -> dict:
    m = session.get(Meeting, meeting_id)
    if m is None:
        raise HTTPException(404, "meeting not found")
    share = summary.prepare(session, m, actor)
    session.commit()
    return _share_view(share)


@router.get("/meetings/{meeting_id}/summaries")
def list_summaries(meeting_id: int, _: str = Depends(require_organizer),
                   session: Session = Depends(get_session)) -> list[dict]:
    return [_share_view(s) for s in session.exec(select(SummaryShare).where(SummaryShare.meeting_id == meeting_id)
                                                 .order_by(SummaryShare.id.desc())).all()]


@router.post("/summaries/{sid}/approve")
def approve_summary(sid: int, body: SummaryApprove, actor: str = Depends(require_organizer),
                    session: Session = Depends(get_session)) -> dict:
    share = session.get(SummaryShare, sid)
    if share is None:
        raise HTTPException(404, "summary not found")
    try:
        summary.approve_and_send(session, share, actor, body.channel, body.recipients, body.content_hash)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    session.commit()
    return _share_view(share)


# ---- agenda & memory -----------------------------------------------------------------

@router.get("/agenda")
def get_agenda(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    return agenda.build(session)


@router.get("/agenda.md")
def agenda_md(_: str = Depends(require_organizer), session: Session = Depends(get_session)) -> PlainTextResponse:
    return PlainTextResponse(agenda.build(session)["markdown"], media_type="text/markdown; charset=utf-8")


@router.post("/memory/query")
def memory_query(body: MemoryQuery, _: str = Depends(require_organizer),
                 session: Session = Depends(get_session)) -> dict:
    return memory.answer(session, body.question, use_llm=body.use_llm)


@router.get("/memory/search")
def memory_search(q: str, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> list[dict]:
    if not q.strip() or len(q) > 500:
        raise HTTPException(422, "query must be 1-500 characters")
    return memory.search(session, q)
