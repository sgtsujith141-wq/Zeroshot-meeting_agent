"""Next-meeting agenda built only from stored state (no generated task states)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from ..config import get_settings
from ..models import ChangeSet, Meeting, OpenQuestion, Task
from .clock import now_utc
from .tasks import OPEN_STATUSES, is_blocked, unfinished_prereqs


def build(session: Session, as_of: date | None = None) -> dict:
    tz = ZoneInfo(get_settings().default_timezone)
    today = as_of or now_utc().astimezone(tz).date()
    meetings = {m.id: m for m in session.exec(select(Meeting)).all()}

    def origin(task: Task) -> dict:
        m = meetings.get(task.origin_meeting_id)
        return {"meeting_id": task.origin_meeting_id, "meeting_title": m.title if m else None,
                "meeting_date": m.scheduled_at if m else None, "evidence": task.evidence}

    overdue, due_soon, blocked, open_no_date, other_open = [], [], [], [], []
    for t in session.exec(select(Task).where(Task.status.in_(OPEN_STATUSES)).order_by(Task.due_date)).all():
        row = {"code": t.code, "title": t.title, "owner": t.owner, "status": t.status, "due_date": t.due_date,
               **origin(t)}
        if is_blocked(session, t):
            row["waiting_for"] = [p.code for p in unfinished_prereqs(session, t)]
            row["blocked_reason"] = t.blocked_reason
            blocked.append(row)
        elif t.due_date and date.fromisoformat(t.due_date) < today:
            overdue.append(row)
        elif t.due_date and (date.fromisoformat(t.due_date) - today).days <= 7:
            due_soon.append(row)
        elif not t.due_date:
            open_no_date.append(row)
        else:
            other_open.append(row)

    questions = [{"id": q.id, "text": q.text, "meeting_id": q.meeting_id,
                  "meeting_title": meetings[q.meeting_id].title if q.meeting_id in meetings else None,
                  "evidence_segment_ids": q.evidence_segment_ids}
                 for q in session.exec(select(OpenQuestion).where(OpenQuestion.status == "open")).all()]
    pending = []
    for cs in session.exec(select(ChangeSet).where(ChangeSet.state.in_(("NEEDS_CLARIFICATION", "READY_FOR_REVIEW")))).all():
        unanswered = [c for c in cs.proposal.get("clarifications", []) if not c.get("answer") and not c.get("deferred")]
        pending.append({"change_set_id": cs.id, "meeting_id": cs.meeting_id, "state": cs.state,
                        "meeting_title": meetings[cs.meeting_id].title if cs.meeting_id in meetings else None,
                        "unanswered_questions": [c["question"] for c in unanswered]})
    sections = {"overdue": overdue, "blocked": blocked, "due_within_7_days": due_soon,
                "open_without_due_date": open_no_date, "other_open": other_open,
                "open_questions": questions, "pending_reviews": pending}
    return {"as_of": today.isoformat(), "timezone": str(tz), "sections": sections,
            "markdown": to_markdown(today, sections)}


def to_markdown(today: date, s: dict) -> str:
    lines = [f"# Next meeting agenda (as of {today.isoformat()})", ""]

    def task_lines(title: str, rows: list[dict], extra=lambda r: "") -> None:  # noqa: ANN001
        if not rows:
            return
        lines.append(f"## {title}")
        for r in rows:
            lines.append(f"- {r['code']} {r['title']} — {r['owner'] or 'unassigned'}, "
                         f"due {r['due_date'] or 'no date'} ({r['status']}){extra(r)} "
                         f"[from “{r['meeting_title']}”]")
        lines.append("")

    task_lines("Overdue", s["overdue"])
    task_lines("Blocked", s["blocked"], lambda r: f"; waiting for {', '.join(r['waiting_for'])}" if r.get("waiting_for") else "")
    task_lines("Due within 7 days", s["due_within_7_days"])
    task_lines("Open, no due date", s["open_without_due_date"])
    task_lines("Other open items", s["other_open"])
    if s["open_questions"]:
        lines.append("## Unresolved questions")
        lines += [f"- {q['text']} [from “{q['meeting_title']}”]" for q in s["open_questions"]]
        lines.append("")
    if s["pending_reviews"]:
        lines.append("## Pending organiser reviews")
        for p in s["pending_reviews"]:
            lines.append(f"- Change set {p['change_set_id']} for “{p['meeting_title']}” ({p['state']})")
            lines += [f"  - {q}" for q in p["unanswered_questions"]]
        lines.append("")
    if len(lines) == 2:
        lines.append("No open items, questions or pending reviews are stored.")
    return "\n".join(lines) + "\n"


def _unused(_: datetime) -> None:  # pragma: no cover
    pass
