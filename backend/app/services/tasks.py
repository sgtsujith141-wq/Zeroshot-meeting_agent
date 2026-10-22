"""Approved-task state machine, dependencies and revisions."""

from __future__ import annotations

from sqlmodel import Session, select

from ..models import Task, TaskDependency, TaskRevision
from .clock import now_utc

STATUSES = ("todo", "in_progress", "blocked", "done", "cancelled")
TRANSITIONS: dict[str, set[str]] = {
    "todo": {"in_progress", "blocked", "done", "cancelled"},
    "in_progress": {"todo", "blocked", "done", "cancelled"},
    "blocked": {"todo", "in_progress", "cancelled"},
    "done": {"in_progress"},  # reopen
    "cancelled": {"todo"},  # restore
}
OPEN_STATUSES = ("todo", "in_progress", "blocked")
# Moving into these requires every prerequisite to be done.
NEEDS_PREREQS = {"in_progress", "done"}


class TransitionError(ValueError):
    pass


def snapshot(task: Task) -> dict:
    return {k: getattr(task, k) for k in (
        "code", "title", "deliverable", "owner", "owner_certainty", "due_date", "deadline_raw",
        "deadline_kind", "timezone", "priority", "priority_basis", "status", "blocked_reason",
        "revision", "origin_meeting_id", "last_meeting_id")}


def prerequisites(session: Session, task: Task) -> list[Task]:
    rows = session.exec(select(TaskDependency).where(TaskDependency.dependent_task_id == task.id)).all()
    return [session.get(Task, r.prerequisite_task_id) for r in rows]


def dependents(session: Session, task: Task) -> list[Task]:
    rows = session.exec(select(TaskDependency).where(TaskDependency.prerequisite_task_id == task.id)).all()
    return [session.get(Task, r.dependent_task_id) for r in rows]


def unfinished_prereqs(session: Session, task: Task) -> list[Task]:
    return [p for p in prerequisites(session, task) if p.status != "done"]


def is_blocked(session: Session, task: Task) -> bool:
    return task.status == "blocked" or (task.status in OPEN_STATUSES and bool(unfinished_prereqs(session, task)))


def check_transition(session: Session, task: Task, new_status: str) -> None:
    if new_status not in STATUSES:
        raise TransitionError(f"unknown status '{new_status}'")
    if new_status == task.status:
        return
    if new_status not in TRANSITIONS[task.status]:
        raise TransitionError(f"{task.code}: {task.status} → {new_status} is not allowed")
    if new_status in NEEDS_PREREQS:
        waiting = unfinished_prereqs(session, task)
        if waiting:
            raise TransitionError(f"{task.code} is waiting for " + ", ".join(
                f"{p.code} ({p.status})" for p in waiting))


def would_cycle(session: Session, prerequisite_id: int, dependent_id: int) -> bool:
    """True if adding prerequisite -> dependent creates a cycle."""
    if prerequisite_id == dependent_id:
        return True
    stack, seen = [prerequisite_id], set()
    while stack:
        tid = stack.pop()
        if tid == dependent_id:
            return True
        if tid in seen:
            continue
        seen.add(tid)
        stack.extend(r.prerequisite_task_id for r in session.exec(
            select(TaskDependency).where(TaskDependency.dependent_task_id == tid)).all())
    return False


def add_dependency(session: Session, prerequisite: Task, dependent: Task) -> bool:
    if would_cycle(session, prerequisite.id, dependent.id):
        raise TransitionError(f"dependency {prerequisite.code} → {dependent.code} would create a cycle")
    exists = session.exec(select(TaskDependency).where(
        TaskDependency.prerequisite_task_id == prerequisite.id,
        TaskDependency.dependent_task_id == dependent.id)).first()
    if exists:
        return False
    session.add(TaskDependency(prerequisite_task_id=prerequisite.id, dependent_task_id=dependent.id))
    session.flush()
    return True


def new_revision(session: Session, task: Task, actor: str, reason: str,
                 change_set_id: int | None = None, meeting_id: int | None = None) -> None:
    task.revision += 1
    task.updated_at = now_utc()
    session.add(task)
    session.flush()
    session.add(TaskRevision(task_id=task.id, revision=task.revision, snapshot=snapshot(task),
                             change_set_id=change_set_id, meeting_id=meeting_id, actor=actor, reason=reason))


def task_view(session: Session, task: Task) -> dict:
    d = snapshot(task)
    d.update({
        "id": task.id, "approved": task.approved, "evidence": task.evidence,
        "created_at": task.created_at.isoformat(), "updated_at": task.updated_at.isoformat(),
        "prerequisites": [{"code": p.code, "title": p.title, "status": p.status} for p in prerequisites(session, task)],
        "dependents": [{"code": p.code, "title": p.title, "status": p.status} for p in dependents(session, task)],
        "is_blocked": is_blocked(session, task),
        "allowed_transitions": sorted(TRANSITIONS[task.status]),
    })
    return d
