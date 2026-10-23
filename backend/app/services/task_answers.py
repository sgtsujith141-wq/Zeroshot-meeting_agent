"""Fast answers about approved task state, straight from the database.

"Who owns X?", "When is X due?", "What's still pending?", "Which tasks are blocked?" and
"What is <person> working on?" do not need a language model: the approved task records are
the authority. These questions are answered here in milliseconds; anything else returns None
and goes to the grounded LLM path in memory.answer.

Matching is deliberately conservative:
- an explicit task code (TASK-3) always wins;
- otherwise a task matches only if at least half of its title's content words appear in the
  question;
- several matching tasks produce a clarifying question instead of a guess;
- no match means "not a task-state question" and falls through to the grounded path.
"""

from __future__ import annotations

import re
from datetime import date

from sqlmodel import Session, select

from ..models import Meeting, Task, TranscriptSegment
from .similarity import content_tokens
from .tasks import OPEN_STATUSES, is_blocked, unfinished_prereqs

CODE = re.compile(r"\btask[-\s]?(\d+)\b", re.I)
# Ownership and due-date wording must be explicit: "who said …" or "when did we decide …" are
# questions about the discussion and go to the grounded path.
OWNER_Q = re.compile(r"\bwho(se)?\b.*\b(own|owns|owned|owner|responsible|assigned|handling|in charge|working on|doing)\b"
                     r"|\bwho(\s+is|'s|\s+will|'ll|\s+is going to)\b", re.I)
WHEN = re.compile(r"\b(due|deadline|by when|what date|which date)\b|\bwhen (is|are|will|should|must)\b", re.I)
DUE_SOON = re.compile(r"\b(overdue|due (this|next) week|due soon|upcoming|due today|due tomorrow|this week)\b", re.I)
PENDING = re.compile(r"\b(pending|outstanding|still open|open tasks?|left to do|remaining|not (yet )?done|unfinished|still to do)\b", re.I)
BLOCKED = re.compile(r"\b(blocked|blocking|blockers?|waiting (on|for)|stuck)\b", re.I)
STATUS = re.compile(r"\b(status|state|progress|done|finished|completed?)\b", re.I)
PERSON_WORK = re.compile(r"\b(working on|assigned|own|owns|responsible for|tasks?|doing)\b", re.I)
# Words that express the question itself rather than name a task.
INTENT = content_tokens("who whose owns owner responsible assigned when date deadline due pending blocked blocking "
                        "waiting stuck open tasks still left remaining doing handling working charge what which "
                        "there any status done finished")
MIN_SHARE = 0.5


def _row(session: Session, t: Task) -> dict:
    return {"code": t.code, "title": t.title, "owner": t.owner, "status": t.status, "due_date": t.due_date,
            "revision": t.revision, "waiting_for": [p.code for p in unfinished_prereqs(session, t)]}


def _when(d: str | None) -> str:
    return date.fromisoformat(d).strftime("%a %d %b %Y") if d else "no due date"


def _evidence(session: Session, tasks: list[Task], per_task: int = 2) -> list[dict]:
    """The stored transcript lines each task was approved from (real segments only)."""
    out: list[dict] = []
    for t in tasks:
        for e in list(t.evidence or [])[-per_task:]:
            seg = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == e["meeting_id"],
                                                               TranscriptSegment.seg_key == e["seg_key"])).first()
            m = session.get(Meeting, e["meeting_id"])
            if seg is None or m is None:
                continue
            out.append({"passage_id": f"E{len(out) + 1}", "doc_type": "segment", "doc_id": f"seg:{m.id}:{seg.seg_key}",
                        "text": seg.text, "meeting_id": m.id, "meeting_title": m.title, "meeting_date": m.scheduled_at,
                        "seg_key": seg.seg_key, "speaker": seg.speaker_label, "start_seconds": seg.start_seconds,
                        "task_code": t.code})
    return out


def _resolve(question: str, tasks: list[Task]) -> list[Task]:
    codes = {f"TASK-{n}" for n in CODE.findall(question)}
    if codes:
        return [t for t in tasks if t.code.upper() in codes]
    words = content_tokens(question) - INTENT
    if not words:
        return []
    scored = []
    for t in tasks:
        title = content_tokens(t.title)
        if title:
            share = len(words & title) / len(title)
            if share >= MIN_SHARE:
                scored.append((share, t))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    # Several tasks matching as well as the best one means the question is ambiguous.
    return [t for s, t in scored if s >= best - 0.15]


def _result(session: Session, question: str, answer: str, tasks: list[Task], **extra) -> dict:
    return {"question": question, "answer": answer, "found": extra.pop("found", True), "mode": "task_records",
            "citations": _evidence(session, tasks), "passages": [], "current_state": [_row(session, t) for t in tasks],
            "note": "answered from approved task records; no language model used", **extra}


def try_answer(session: Session, question: str) -> dict | None:
    q = question.strip()
    tasks = session.exec(select(Task).order_by(Task.id)).all()
    if not tasks:
        return None
    open_tasks = [t for t in tasks if t.status in OPEN_STATUSES]
    people = sorted({t.owner for t in tasks if t.owner}, key=len, reverse=True)
    person = next((p for p in people if re.search(rf"\b{re.escape(p)}\b", q, re.I)), None)
    named = _resolve(q, tasks)

    if len(named) > 1 and (OWNER_Q.search(q) or WHEN.search(q) or BLOCKED.search(q)):
        listed = "; ".join(f"{t.code} “{t.title}”" for t in named)
        return _result(session, q, f"Which task do you mean? Several match: {listed}.", named, found=False,
                       clarify=[{"code": t.code, "title": t.title} for t in named])

    if len(named) == 1:
        t = named[0]
        parts = []
        if OWNER_Q.search(q):
            parts.append(f"{t.code} “{t.title}” is owned by {t.owner}." if t.owner else f"{t.code} “{t.title}” has no owner yet.")
        if WHEN.search(q):
            parts.append(f"{t.code} is due {_when(t.due_date)}." if t.due_date else f"{t.code} has no due date.")
        if BLOCKED.search(q):
            waits = unfinished_prereqs(session, t)
            parts.append(f"{t.code} is waiting for {', '.join(f'{p.code} “{p.title}”' for p in waits)}." if waits
                         else f"{t.code} is blocked: {t.blocked_reason or 'no reason recorded'}." if t.status == "blocked"
                         else f"{t.code} is not blocked.")
        if not parts and STATUS.search(q) and CODE.search(q):
            parts.append(f"{t.code} “{t.title}” is {t.status.replace('_', ' ')} (revision {t.revision}), owned by "
                         f"{t.owner or 'nobody yet'}, due {_when(t.due_date)}.")
        elif parts and t.status in ("done", "cancelled"):
            parts.append(f"It is {t.status}.")
        if parts:
            return _result(session, q, " ".join(parts), [t])
        return None

    if BLOCKED.search(q):
        blocked = [t for t in open_tasks if is_blocked(session, t)]
        if not blocked:
            return _result(session, q, "No open task is blocked.", [])
        lines = []
        for t in blocked:
            waits = unfinished_prereqs(session, t)
            lines.append(f"{t.code} “{t.title}” ({t.owner or 'unassigned'}) is waiting for "
                         + (", ".join(p.code for p in waits) if waits else (t.blocked_reason or "a reason not recorded")))
        return _result(session, q, f"{len(blocked)} blocked: " + "; ".join(lines) + ".", blocked)

    if person and (PERSON_WORK.search(q) or PENDING.search(q)):
        mine = [t for t in open_tasks if t.owner == person]
        if not mine:
            return _result(session, q, f"{person} has no open approved tasks.", [])
        listed = "; ".join(f"{t.code} “{t.title}”, due {_when(t.due_date)}" for t in mine)
        return _result(session, q, f"{person} has {len(mine)} open task{'s' if len(mine) != 1 else ''}: {listed}.", mine)

    if DUE_SOON.search(q):
        from .agenda import build  # same date logic as the Follow-ups agenda
        s = build(session)["sections"]
        rows = s["overdue"] + s["due_within_7_days"]
        soon = [t for t in tasks if t.code in {r["code"] for r in rows}]
        if not soon:
            return _result(session, q, "No open task is overdue or due in the next 7 days.", [])
        overdue = {r["code"] for r in s["overdue"]}
        listed = "; ".join(f"{t.code} “{t.title}” ({t.owner or 'unassigned'}, {'overdue since ' if t.code in overdue else 'due '}{_when(t.due_date)})" for t in soon)
        return _result(session, q, f"{len(soon)} task{'s' if len(soon) != 1 else ''} overdue or due within 7 days: {listed}.", soon)

    if PENDING.search(q):
        if not open_tasks:
            return _result(session, q, "Nothing is pending: every approved task is done or cancelled.", [])
        listed = "; ".join(f"{t.code} “{t.title}” ({t.owner or 'unassigned'}, {_when(t.due_date)})" for t in open_tasks)
        return _result(session, q, f"{len(open_tasks)} open task{'s' if len(open_tasks) != 1 else ''}: {listed}.", open_tasks)

    return None
