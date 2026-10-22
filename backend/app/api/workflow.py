from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..auth import require_organizer
from ..db import get_session
from ..models import ChangeSet, Meeting, Task, TaskDependency, TaskRevision, TranscriptSegment
from ..schemas import ApproveRequest, ChangeSetPatch, DependencyCreate, RejectRequest, TaskPatch
from ..services import calendar, changesets, memory, reminders
from ..services.audit import record
from ..services.tasks import (
    TransitionError, add_dependency, check_transition, new_revision, snapshot, task_view,
)

router = APIRouter(prefix="/api", tags=["review & tasks"])


def _cs(session: Session, cs_id: int) -> ChangeSet:
    cs = session.get(ChangeSet, cs_id)
    if cs is None:
        raise HTTPException(404, "change set not found")
    return cs


def cs_view(session: Session, cs: ChangeSet) -> dict:
    segs = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == cs.meeting_id)
                        .order_by(TranscriptSegment.order_index)).all()
    m = session.get(Meeting, cs.meeting_id)
    return {"id": cs.id, "meeting_id": cs.meeting_id, "meeting_title": m.title if m else None,
            "state": cs.state, "version": cs.version, "proposal": cs.proposal, "proposal_hash": cs.proposal_hash,
            "organizer_edits": cs.organizer_edits, "applied_result": cs.applied_result, "error": cs.error,
            "ledger_snapshot": cs.ledger_snapshot, "updated_at": cs.updated_at.isoformat(),
            "segments": {s.seg_key: {"speaker_label": s.speaker_label, "start_seconds": s.start_seconds,
                                     "end_seconds": s.end_seconds, "text": s.text} for s in segs}}


@router.get("/changesets")
def list_change_sets(state: str | None = None, _: str = Depends(require_organizer),
                     session: Session = Depends(get_session)) -> list[dict]:
    q = select(ChangeSet).order_by(ChangeSet.id.desc())
    if state:
        q = q.where(ChangeSet.state == state)
    out = []
    for cs in session.exec(q).all():
        m = session.get(Meeting, cs.meeting_id)
        items = cs.proposal.get("items", [])
        out.append({"id": cs.id, "meeting_id": cs.meeting_id, "meeting_title": m.title if m else None,
                    "state": cs.state, "version": cs.version, "items": len(items),
                    "open_questions": sum(1 for c in cs.proposal.get("clarifications", [])
                                          if not c.get("answer") and not c.get("deferred")),
                    "updated_at": cs.updated_at.isoformat()})
    return out


@router.get("/meetings/{meeting_id}/changeset")
def meeting_change_set(meeting_id: int, _: str = Depends(require_organizer),
                       session: Session = Depends(get_session)) -> dict:
    cs = session.exec(select(ChangeSet).where(ChangeSet.meeting_id == meeting_id)
                      .order_by(ChangeSet.id.desc())).first()
    if cs is None:
        raise HTTPException(404, "no change set for this meeting yet")
    return cs_view(session, cs)


@router.post("/meetings/{meeting_id}/changeset/recompute")
def recompute(meeting_id: int, actor: str = Depends(require_organizer),
              session: Session = Depends(get_session)) -> dict:
    if session.get(Meeting, meeting_id) is None:
        raise HTTPException(404, "meeting not found")
    cs = changesets.create_or_refresh(session, meeting_id, actor)
    session.commit()
    return cs_view(session, cs)


@router.get("/changesets/{cs_id}")
def get_change_set(cs_id: int, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    return cs_view(session, _cs(session, cs_id))


@router.patch("/changesets/{cs_id}")
def edit_change_set(cs_id: int, body: ChangeSetPatch, actor: str = Depends(require_organizer),
                    session: Session = Depends(get_session)) -> dict:
    cs = _cs(session, cs_id)
    patch = {"answers": {k: (v.model_dump() if v else None) for k, v in body.answers.items()},
             "items": body.items,
             "decisions": {k: v.model_dump(exclude_unset=True) for k, v in body.decisions.items()}}
    try:
        changesets.edit(session, cs, actor, patch)
    except (changesets.ChangeSetError, ValueError) as exc:
        raise HTTPException(getattr(exc, "status", 422), str(exc)) from exc
    session.commit()
    return cs_view(session, cs)


@router.post("/changesets/{cs_id}/approve")
def approve(cs_id: int, body: ApproveRequest, actor: str = Depends(require_organizer),
            session: Session = Depends(get_session)) -> dict:
    cs = _cs(session, cs_id)
    try:
        result = changesets.approve(session, cs, actor, body.proposal_hash)
        session.commit()
    except changesets.ChangeSetApplyError as exc:
        session.rollback()
        cs = _cs(session, cs_id)
        cs.state, cs.error = "FAILED", str(exc)
        record(session, actor, "changeset", cs.id, "apply", result="failed", after={"error": str(exc)})
        session.commit()
        raise HTTPException(409, str(exc)) from exc
    except changesets.ChangeSetError as exc:
        session.rollback()
        raise HTTPException(exc.status, str(exc)) from exc
    except IntegrityError:
        # A concurrent identical approval won the race: report its result, never apply twice.
        session.rollback()
        cs = _cs(session, cs_id)
        if cs.state == "APPLIED":
            return {"change_set": cs_view(session, cs), "result": {"idempotent_replay": True, **cs.applied_result}}
        raise HTTPException(409, "approval conflict; reload and retry")
    return {"change_set": cs_view(session, cs), "result": result}


@router.post("/changesets/{cs_id}/reject")
def reject(cs_id: int, body: RejectRequest, actor: str = Depends(require_organizer),
           session: Session = Depends(get_session)) -> dict:
    cs = _cs(session, cs_id)
    try:
        changesets.reject(session, cs, actor, body.reason)
    except changesets.ChangeSetError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    session.commit()
    return cs_view(session, cs)


# ---- tasks -------------------------------------------------------------------

def _task(session: Session, code: str) -> Task:
    t = session.exec(select(Task).where(Task.code == code)).first()
    if t is None:
        raise HTTPException(404, "task not found")
    return t


@router.get("/tasks")
def list_tasks(status: str | None = None, owner: str | None = None, _: str = Depends(require_organizer),
               session: Session = Depends(get_session)) -> list[dict]:
    q = select(Task).order_by(Task.id)
    if status:
        q = q.where(Task.status == status)
    if owner:
        q = q.where(Task.owner == owner)
    return [task_view(session, t) for t in session.exec(q).all()]


@router.get("/tasks/{code}")
def get_task(code: str, _: str = Depends(require_organizer), session: Session = Depends(get_session)) -> dict:
    t = _task(session, code)
    revs = session.exec(select(TaskRevision).where(TaskRevision.task_id == t.id).order_by(TaskRevision.revision)).all()
    evidence = []
    for e in t.evidence:
        seg = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == e["meeting_id"],
                                                           TranscriptSegment.seg_key == e["seg_key"])).first()
        m = session.get(Meeting, e["meeting_id"])
        evidence.append({**e, "meeting_title": m.title if m else None, "meeting_date": m.scheduled_at if m else None,
                         "speaker_label": seg.speaker_label if seg else None, "text": seg.text if seg else None,
                         "start_seconds": seg.start_seconds if seg else None, "exists": seg is not None})
    from ..models import CalendarEvent, Reminder
    ev = session.exec(select(CalendarEvent).where(CalendarEvent.task_id == t.id)).first()
    rems = session.exec(select(Reminder).where(Reminder.task_id == t.id).order_by(Reminder.scheduled_at)).all()
    return {**task_view(session, t),
            "revisions": [{"revision": r.revision, "snapshot": r.snapshot, "actor": r.actor, "reason": r.reason,
                           "change_set_id": r.change_set_id, "meeting_id": r.meeting_id,
                           "created_at": r.created_at.isoformat()} for r in revs],
            "evidence_detail": evidence,
            "calendar_event": ev.model_dump(mode="json") if ev else None,
            "reminders": [r.model_dump(mode="json") for r in rems]}


@router.patch("/tasks/{code}")
def patch_task(code: str, body: TaskPatch, actor: str = Depends(require_organizer),
               session: Session = Depends(get_session)) -> dict:
    t = _task(session, code)
    if body.expected_revision != t.revision:
        raise HTTPException(409, f"{code} is at revision {t.revision}, not {body.expected_revision}; reload")
    before = snapshot(t)
    fields = body.model_dump(exclude_unset=True, exclude={"expected_revision"})
    try:
        if "status" in fields:
            check_transition(session, t, fields["status"])
            t.status = fields["status"]
            if t.status != "blocked":
                t.blocked_reason = None
    except TransitionError as exc:
        raise HTTPException(409, str(exc)) from exc
    if "blocked_reason" in fields:
        t.blocked_reason = fields["blocked_reason"]
    if "owner" in fields:
        t.owner, t.owner_certainty = fields["owner"] or None, "confirmed"
    if "due_date" in fields:
        t.due_date, t.deadline_kind = fields["due_date"], "set_by_organiser" if fields["due_date"] else "none"
    if "priority" in fields:
        t.priority, t.priority_basis = fields["priority"], "set by organiser"
    if "title" in fields and fields["title"]:
        t.title = fields["title"]
    if snapshot(t) == before:
        return task_view(session, t)
    new_revision(session, t, actor, "organiser edit on task board")
    if {"due_date", "status", "title"} & fields.keys():
        calendar.upsert_event(session, t, None)
        reminders.schedule_for_task(session, t, None)
    memory.index_task(session, t)
    record(session, actor, "task", t.code, "edit", before, snapshot(t))
    session.commit()
    return task_view(session, t)


@router.post("/tasks/{code}/dependencies")
def add_dep(code: str, body: DependencyCreate, actor: str = Depends(require_organizer),
            session: Session = Depends(get_session)) -> dict:
    t, pre = _task(session, code), _task(session, body.prerequisite_code)
    try:
        add_dependency(session, pre, t)
    except TransitionError as exc:
        raise HTTPException(409, str(exc)) from exc
    record(session, actor, "task", t.code, "add_dependency", after={"prerequisite": pre.code})
    session.commit()
    return task_view(session, t)


@router.delete("/tasks/{code}/dependencies/{prereq}")
def remove_dep(code: str, prereq: str, actor: str = Depends(require_organizer),
               session: Session = Depends(get_session)) -> dict:
    t, pre = _task(session, code), _task(session, prereq)
    row = session.exec(select(TaskDependency).where(TaskDependency.prerequisite_task_id == pre.id,
                                                    TaskDependency.dependent_task_id == t.id)).first()
    if row:
        session.delete(row)
        record(session, actor, "task", t.code, "remove_dependency", before={"prerequisite": pre.code})
        session.commit()
    return task_view(session, t)
