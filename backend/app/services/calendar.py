"""In-app calendar events for approved tasks + RFC 5545 .ics export.

Deadlines are date-only, so events are all-day (VALUE=DATE) on the local due
date; no clock time is invented. No third-party calendar API is configured, so
.ics download is labelled "export", never "sync".
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlmodel import Session, select

from ..models import CalendarEvent, Meeting, Task
from .clock import now_utc


def upsert_event(session: Session, task: Task, approval_id: int | None) -> CalendarEvent | None:
    ev = session.exec(select(CalendarEvent).where(CalendarEvent.task_id == task.id)).first()
    if not task.due_date or task.status == "cancelled":
        if ev:
            session.delete(ev)
        return None
    if ev is None:
        ev = CalendarEvent(task_id=task.id, uid=f"{task.code.lower()}@ps53-meeting-agent.local",
                           title=f"{task.code} due: {task.title}", date=task.due_date,
                           timezone=task.timezone, approval_id=approval_id)
    else:
        if ev.date != task.due_date or ev.title != f"{task.code} due: {task.title}":
            ev.sequence += 1
        ev.date, ev.title, ev.timezone = task.due_date, f"{task.code} due: {task.title}", task.timezone
        ev.approval_id = approval_id or ev.approval_id
        ev.updated_at = now_utc()
    session.add(ev)
    return ev


def _esc(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> str:
    out, raw = [], line.encode("utf-8")
    while len(raw) > 75:
        cut = 75
        while (raw[cut] & 0xC0) == 0x80:  # do not split a UTF-8 sequence
            cut -= 1
        out.append(raw[:cut].decode("utf-8"))
        raw = b" " + raw[cut:]
    out.append(raw.decode("utf-8"))
    return "\r\n".join(out)


def to_ics(session: Session, events: list[CalendarEvent]) -> str:
    stamp = now_utc().strftime("%Y%m%dT%H%M%SZ")
    tzs = sorted({e.timezone for e in events}) or ["Asia/Kolkata"]
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PS53 Meeting Agent//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-TIMEZONE:{tzs[0]}"]
    for e in events:
        task = session.get(Task, e.task_id)
        meeting = session.get(Meeting, task.origin_meeting_id) if task else None
        d = date.fromisoformat(e.date)
        desc = (f"Owner: {task.owner or 'unassigned'}\nStatus: {task.status}\n"
                f"Origin meeting: {meeting.title if meeting else '?'} ({meeting.scheduled_at if meeting else ''})\n"
                f"Deadline as spoken: {task.deadline_raw or '-'} ({task.deadline_kind}); timezone {e.timezone}")
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{stamp}", f"SEQUENCE:{e.sequence}",
                  f"DTSTART;VALUE=DATE:{d:%Y%m%d}", f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}",
                  f"SUMMARY:{_esc(e.title)}", f"DESCRIPTION:{_esc(desc)}", "TRANSP:TRANSPARENT",
                  "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
