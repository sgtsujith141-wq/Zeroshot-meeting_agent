"""Proposed change sets: build from stored events, organiser overlay, approval, apply.

Nothing reaches the task board without an Approval row whose hash equals the
exact proposal the organiser reviewed. Applying is transactional and idempotent.
"""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import date
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from ..models import (
    Approval, ChangeSet, CommitmentEvent, Decision, Meeting, Participant, Task, TaskRevision,
    TranscriptSegment,
)
from . import calendar, memory, reminders
from .audit import record
from .clock import now_utc
from .identity import SpeakerDirectory
from .llm_schemas import CommitmentEventOut
from .reconcile import EXISTENCE_ISSUES, LedgerTask, ReconcileContext, Segment, reconcile
from .tasks import OPEN_STATUSES, TransitionError, add_dependency, snapshot

ACTIONABLE_OPS = {"create", "update", "cancel", "complete", "create_completed"}
OWNER_KINDS = {"missing_owner", "group_owner", "pending_acceptance", "unmapped_speaker"}
ANSWER_CHOICES = {
    "missing_owner": {"set_owner", "unassigned"},
    "group_owner": {"set_owner", "unassigned"},
    "unmapped_speaker": {"set_owner", "unassigned"},
    "pending_acceptance": {"accepted", "set_owner", "unassigned"},
    "ambiguous_deadline": {"set_due", "no_deadline"},
    "ambiguous_cancellation_existing": {"cancel_task", "keep_task"},
    "ambiguous_cancellation_new": {"cancel", "keep"},
    "possible_existing_match": {"link", "new"},
    "ambiguous_reference": {"link", "new"},
    "unverified_reference": {"confirm", "new", "drop"},
    "instruction_to_assistant": {"drop", "keep"},
    "missing_prerequisite": {"drop_dependency", "link"},
}


class ChangeSetError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


class ChangeSetApplyError(ChangeSetError):
    """Approved, but applying failed (e.g. a task changed concurrently). Nothing was written."""


# ---------------------------------------------------------------------------
# Inputs from the database
# ---------------------------------------------------------------------------

def meeting_segments(session: Session, meeting_id: int) -> list[Segment]:
    rows = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting_id)
                        .order_by(TranscriptSegment.order_index)).all()
    return [Segment(id=r.seg_key, speaker=r.speaker_label, start=r.start_seconds, end=r.end_seconds, text=r.text)
            for r in rows]


def speaker_directory(session: Session, meeting_id: int) -> SpeakerDirectory:
    parts = session.exec(select(Participant).where(Participant.meeting_id == meeting_id)).all()
    mapping = {p.speaker_label: p.display_name for p in parts if p.display_name}
    known = sorted({p.display_name for p in session.exec(select(Participant)).all() if p.display_name}
                   | {t.owner for t in session.exec(select(Task)).all() if t.owner})
    return SpeakerDirectory(mapping, known_people=known)


def active_ledger(session: Session, exclude_meeting: int | None = None) -> tuple[list[LedgerTask], list[dict]]:
    tasks = session.exec(select(Task).where(Task.status.in_(OPEN_STATUSES)).order_by(Task.id)).all()
    ledger = []
    for t in tasks:
        deps = [d["code"] for d in _prereq_codes(session, t)]
        ledger.append(LedgerTask(task_id=t.code, title=t.title, owner=t.owner, due_date=t.due_date,
                                 status=t.status, depends_on=deps))
    return ledger, [{"code": t.code, "revision": t.revision} for t in tasks]


def _prereq_codes(session: Session, task: Task) -> list[dict]:
    from .tasks import prerequisites
    return [{"code": p.code} for p in prerequisites(session, task)]


def stored_events(session: Session, meeting_id: int) -> list[CommitmentEventOut]:
    rows = session.exec(select(CommitmentEvent).where(CommitmentEvent.meeting_id == meeting_id)
                        .order_by(CommitmentEvent.seq)).all()
    return [CommitmentEventOut.model_validate(r.payload) for r in rows]


def _meeting_date(meeting: Meeting) -> date:
    from datetime import datetime
    return datetime.fromisoformat(meeting.scheduled_at).date()


# ---------------------------------------------------------------------------
# Overlay of organiser answers and edits (deterministic)
# ---------------------------------------------------------------------------

def _answer_for(answers: dict, clar: dict) -> dict | None:
    for key in clar["item_keys"]:
        a = answers.get(f"{key}|{clar['kind']}")
        if a:
            return a
    return None


def overlay(base: dict, edits: dict, ledger: list[LedgerTask], meeting: Meeting) -> dict:
    p = copy.deepcopy(base)
    answers = edits.get("answers", {})
    item_edits = edits.get("items", {})
    ledger_by_id = {t.task_id: t for t in ledger}
    clar_by_id = {c["id"]: c for c in p["clarifications"]}

    for item in p["items"]:
        item.setdefault("excluded", False)
        own = [clar_by_id[c] for c in item["clarification_ids"] if c in clar_by_id]
        for c in own:
            c["answer"] = _answer_for(answers, c)
        # Existence answers first; they decide whether attribute questions matter.
        for c in sorted(own, key=lambda c: c["rank"]):
            a = c.get("answer")
            if not a:
                continue
            choice, value = a.get("choice"), a.get("value")
            kind = c["kind"]
            if kind in OWNER_KINDS:
                if choice == "accepted":
                    item["owner"], item["owner_status"] = item.get("owner_candidate"), "accepted_per_organiser"
                elif choice == "set_owner":
                    item["owner"], item["owner_status"] = value, "set_by_organiser"
                elif choice == "unassigned":
                    item["owner"], item["owner_status"] = None, "unassigned_by_organiser"
            elif kind == "ambiguous_deadline":
                item["deadline"] = {**item["deadline"], "date": value if choice == "set_due" else None,
                                    "kind": "set_by_organiser" if choice == "set_due" else "none",
                                    "ambiguous": False}
            elif kind == "ambiguous_cancellation_existing":
                if choice == "cancel_task":
                    item["operation"] = "cancel"
                elif item["operation"] == "hold":
                    item["operation"] = _existing_op(item, ledger_by_id)
            elif kind == "ambiguous_cancellation_new":
                if choice == "cancel":
                    item["state"], item["operation"] = "cancelled", "drop"
                elif item["operation"] == "hold":
                    item["operation"] = "create"
            elif kind in ("possible_existing_match", "ambiguous_reference"):
                if choice == "link" and value in ledger_by_id:
                    t = ledger_by_id[value]
                    item["existing_task_id"] = value
                    item["before"] = {"title": t.title, "owner": t.owner, "due_date": t.due_date,
                                      "status": t.status, "depends_on": list(t.depends_on)}
                    item["owner"] = item["owner"] or t.owner
                    if not item["deadline"].get("date") and t.due_date:
                        item["deadline"] = {**item["deadline"], "date": t.due_date, "kind": "explicit"}
                    item["title"] = t.title
                    item["operation"] = _existing_op(item, ledger_by_id)
                elif choice == "new":
                    item["existing_task_id"], item["before"] = None, None
                    item["operation"] = "create"
            elif kind == "unverified_reference":
                if choice == "confirm" and item["operation"] == "hold":
                    item["operation"] = _existing_op(item, ledger_by_id)
                elif choice == "new":
                    item["existing_task_id"], item["before"], item["operation"] = None, None, "create"
                elif choice == "drop":
                    item["excluded"] = True
            elif kind == "instruction_to_assistant":
                if choice == "drop":
                    item["excluded"] = True
                elif item["operation"] == "hold":
                    item["operation"] = "create"
            elif kind == "missing_prerequisite":
                dep = c["data"].get("depends_on")
                if choice == "drop_dependency":
                    item["depends_on"] = [d for d in item["depends_on"] if d["key"] != dep]
                elif choice == "link" and value:
                    title = ledger_by_id[value].title if value in ledger_by_id else value
                    item["depends_on"].append({"key": value, "title": title,
                                               "existing_task_id": value if value in ledger_by_id else None})

        e = item_edits.get(item["key"], {})
        if e.get("excluded") is not None:
            item["excluded"] = bool(e["excluded"])
        for f in ("title", "deliverable"):
            if e.get(f):
                item[f] = e[f]
        if "owner" in e:
            item["owner"], item["owner_status"] = (e["owner"] or None), "set_by_organiser"
            for c in own:
                if c["kind"] in OWNER_KINDS:
                    c["answer"] = c.get("answer") or {"choice": "set_owner", "value": e["owner"], "via": "edit"}
        if "due_date" in e:
            item["deadline"] = {**item["deadline"], "date": e["due_date"] or None,
                                "kind": "set_by_organiser" if e["due_date"] else "none", "ambiguous": False}
            for c in own:
                if c["kind"] == "ambiguous_deadline":
                    c["answer"] = c.get("answer") or {"choice": "set_due", "value": e["due_date"], "via": "edit"}
        if e.get("priority"):
            item["priority"] = {"value": e["priority"], "basis": "set by organiser"}
        if e.get("drop_dependencies"):
            item["depends_on"] = [d for d in item["depends_on"] if d["key"] not in e["drop_dependencies"]]
        if e.get("promote") and item["state"] == "tentative":
            if not (e.get("owner") or item.get("owner")):
                raise ChangeSetError(f"promoting “{item['title']}” requires an owner", 422)
            item["state"], item["operation"] = "proposed", "create"
        if item["existing_task_id"] and item["operation"] == "update" and not _changed(item):
            item["operation"] = "none"

        # Resurface deferred questions once their item's existence questions are answered.
        open_existence = [c for c in own if c["kind"] in EXISTENCE_ISSUES and not c.get("answer")]
        for c in own:
            if c.get("deferred") and not open_existence:
                c["deferred"] = False
        unresolved = [c for c in own if not c.get("answer") and not c.get("deferred")]
        if item["excluded"]:
            item["state"] = "excluded"
        elif item["state"] in ("tentative", "cancelled", "rejected", "completed"):
            pass
        elif any(c["kind"] in EXISTENCE_ISSUES for c in unresolved):
            item["state"] = "held"
        elif unresolved:
            item["state"] = "needs_clarification"
        elif item["operation"] == "drop":
            item["state"] = "cancelled"
        elif item["operation"] == "none":
            item["state"] = "no_change"
        else:
            item["state"] = "proposed"
        item["plan"] = _plan(item, meeting)

    for d in p.get("decisions_review", []):
        de = edits.get("decisions", {}).get(str(d["id"]), {})
        if "include" in de:
            d["include"] = bool(de["include"])
        if de.get("text"):
            d["text"] = de["text"]
    return p


def _existing_op(item: dict, ledger_by_id: dict) -> str:
    return "update" if _changed(item) else "none"


def _changed(item: dict) -> bool:
    b = item.get("before") or {}
    deps = sorted(d.get("existing_task_id") or d["key"] for d in item["depends_on"])
    return (item["owner"] != b.get("owner") or item["deadline"].get("date") != b.get("due_date")
            or deps != sorted(b.get("depends_on") or []) or bool(item.get("blocked_reason")))


def _plan(item: dict, meeting: Meeting) -> dict:
    due = item["deadline"].get("date")
    applies = item["state"] == "proposed" and item["operation"] in ("create", "update")
    at = reminders.plan_reminder(due, meeting.timezone) if (applies and due) else None
    local = at.astimezone(ZoneInfo(meeting.timezone)).isoformat() if at else None
    return {"calendar_event": bool(applies and due), "in_app_reminder_at": local}


def proposal_hash(proposal: dict) -> str:
    return hashlib.sha256(json.dumps(proposal, sort_keys=True, default=str).encode()).hexdigest()


def _state_for(proposal: dict) -> str:
    for item in proposal["items"]:
        if item["state"] in ("held", "needs_clarification"):
            return "NEEDS_CLARIFICATION"
    return "READY_FOR_REVIEW"


# ---------------------------------------------------------------------------
# Build / recompute
# ---------------------------------------------------------------------------

def compute(session: Session, cs: ChangeSet) -> ChangeSet:
    meeting = session.get(Meeting, cs.meeting_id)
    segments = meeting_segments(session, meeting.id)
    ledger, snap = active_ledger(session)
    ctx = ReconcileContext(meeting_date=_meeting_date(meeting),
                           directory=speaker_directory(session, meeting.id), ledger=ledger)
    result = reconcile(segments, stored_events(session, meeting.id), ctx).to_dict()
    decisions = session.exec(select(Decision).where(Decision.meeting_id == meeting.id)).all()
    result["decisions_review"] = [{"id": d.id, "text": d.text, "rationale": d.rationale,
                                   "evidence_segment_ids": d.evidence_segment_ids,
                                   "include": d.approval_status != "rejected"} for d in decisions]
    proposal = overlay(result, cs.organizer_edits or {}, ledger, meeting)
    cs.base_result, cs.proposal, cs.ledger_snapshot = result, proposal, snap
    cs.proposal_hash = proposal_hash(proposal)
    cs.state = _state_for(proposal)
    cs.updated_at = now_utc()
    session.add(cs)
    return cs


def open_change_set(session: Session, meeting_id: int) -> ChangeSet | None:
    return session.exec(select(ChangeSet).where(
        ChangeSet.meeting_id == meeting_id,
        ChangeSet.state.in_(("DRAFT", "NEEDS_CLARIFICATION", "READY_FOR_REVIEW")))
        .order_by(ChangeSet.id.desc())).first()


def create_or_refresh(session: Session, meeting_id: int, actor: str) -> ChangeSet:
    cs = open_change_set(session, meeting_id)
    if cs is None:
        cs = ChangeSet(meeting_id=meeting_id)
        session.add(cs)
        session.flush()
        record(session, actor, "changeset", cs.id, "create")
    else:
        cs.version += 1
    return compute(session, cs)


def edit(session: Session, cs: ChangeSet, actor: str, patch: dict) -> ChangeSet:
    if cs.state not in ("DRAFT", "NEEDS_CLARIFICATION", "READY_FOR_REVIEW"):
        raise ChangeSetError(f"change set is {cs.state}; it can no longer be edited")
    edits = copy.deepcopy(cs.organizer_edits or {})
    for kind_key, answer in (patch.get("answers") or {}).items():
        item_key, _, kind = kind_key.partition("|")
        if kind not in ANSWER_CHOICES:
            raise ChangeSetError(f"unknown clarification kind '{kind}'", 422)
        if answer is None:
            edits.setdefault("answers", {}).pop(kind_key, None)
            continue
        if answer.get("choice") not in ANSWER_CHOICES[kind]:
            raise ChangeSetError(f"choice '{answer.get('choice')}' not valid for {kind}", 422)
        if answer["choice"] in ("set_owner", "set_due", "link") and not answer.get("value"):
            raise ChangeSetError(f"choice '{answer['choice']}' requires a value", 422)
        if answer["choice"] == "set_due":
            date.fromisoformat(answer["value"])
        edits.setdefault("answers", {})[kind_key] = {"choice": answer["choice"], "value": answer.get("value")}
    for key, e in (patch.get("items") or {}).items():
        if e.get("due_date"):
            date.fromisoformat(e["due_date"])
        allowed = {k: v for k, v in e.items() if k in ("title", "deliverable", "owner", "due_date", "priority",
                                                       "excluded", "promote", "drop_dependencies")}
        edits.setdefault("items", {}).setdefault(key, {}).update(allowed)
    for did, e in (patch.get("decisions") or {}).items():
        edits.setdefault("decisions", {}).setdefault(str(did), {}).update(
            {k: v for k, v in e.items() if k in ("include", "text")})
    before = cs.organizer_edits
    cs.organizer_edits = edits
    cs.version += 1
    compute(session, cs)
    record(session, actor, "changeset", cs.id, "edit", {"edits": before}, {"edits": edits})
    return cs


# ---------------------------------------------------------------------------
# Approval and application
# ---------------------------------------------------------------------------

def reject(session: Session, cs: ChangeSet, actor: str, reason: str | None) -> ChangeSet:
    if cs.state in ("APPLIED", "APPROVED"):
        raise ChangeSetError(f"change set already {cs.state}")
    if cs.state == "REJECTED":
        return cs
    cs.state = "REJECTED"
    session.add(Approval(actor=actor, scope=f"changeset:{cs.id}", decision="rejected",
                         snapshot_hash=cs.proposal_hash + ":rejected", snapshot={"reason": reason}))
    record(session, actor, "changeset", cs.id, "reject", after={"reason": reason})
    return cs


def approve(session: Session, cs: ChangeSet, actor: str, reviewed_hash: str) -> dict:
    scope = f"changeset:{cs.id}"
    if cs.state == "APPLIED":
        prior = session.exec(select(Approval).where(Approval.scope == scope,
                                                    Approval.decision == "approved")).first()
        if prior and prior.snapshot_hash == reviewed_hash:
            return {"idempotent_replay": True, **cs.applied_result}
        raise ChangeSetError("change set was already applied with a different reviewed version")
    if cs.state == "NEEDS_CLARIFICATION":
        raise ChangeSetError("unanswered clarification questions remain; answer them or exclude the items")
    if cs.state != "READY_FOR_REVIEW":
        raise ChangeSetError(f"change set is {cs.state}; only READY_FOR_REVIEW can be approved")
    # Recompute against the current ledger; the organiser must have reviewed exactly this.
    compute(session, cs)
    if cs.proposal_hash != reviewed_hash:
        raise ChangeSetError("the proposal changed since it was reviewed; reload and review again")
    if cs.state != "READY_FOR_REVIEW":
        raise ChangeSetError("unanswered clarification questions remain")

    approval = Approval(actor=actor, scope=scope, snapshot_hash=cs.proposal_hash, snapshot=cs.proposal,
                        approved_at=now_utc())
    session.add(approval)
    session.flush()
    cs.state = "APPROVED"
    record(session, actor, "changeset", cs.id, "approve", after={"hash": cs.proposal_hash})
    try:
        result = _apply(session, cs, approval, actor)
    except (TransitionError, ChangeSetError) as exc:
        session.rollback()
        raise ChangeSetApplyError(f"could not apply approved change set: {exc}") from exc
    cs.state, cs.applied_result, cs.updated_at = "APPLIED", result, now_utc()
    session.add(cs)
    record(session, actor, "changeset", cs.id, "apply", after=result)
    return {"idempotent_replay": False, **result}


def _next_code(session: Session) -> str:
    n = len(session.exec(select(Task.id)).all()) + 1
    while session.exec(select(Task).where(Task.code == f"TASK-{n}")).first():
        n += 1
    return f"TASK-{n}"


def _apply(session: Session, cs: ChangeSet, approval: Approval, actor: str) -> dict:
    meeting = session.get(Meeting, cs.meeting_id)
    revs = {r["code"]: r["revision"] for r in cs.ledger_snapshot}
    created: dict[str, str] = {}
    updated, cancelled, completed, skipped = [], [], [], []
    tasks_by_key: dict[str, Task] = {}

    items = cs.proposal["items"]
    for item in items:
        op = item["operation"]
        if item["state"] != "proposed" or op not in ACTIONABLE_OPS:
            skipped.append({"key": item["key"], "state": item["state"], "operation": op})
            continue
        deadline = item["deadline"]
        evidence = [{"meeting_id": meeting.id, "seg_key": s} for s in item["evidence_segment_ids"]]
        owner_cert = {"self_mapped": "inferred_from_speaker", "set_by_organiser": "confirmed",
                      "accepted_per_organiser": "confirmed"}.get(item["owner_status"], "named")
        if op in ("create", "create_completed"):
            t = Task(code=_next_code(session), title=item["title"], deliverable=item.get("deliverable"),
                     owner=item["owner"], owner_certainty=owner_cert, due_date=deadline.get("date"),
                     deadline_raw=deadline.get("raw"), deadline_kind=deadline.get("kind", "none"),
                     timezone=meeting.timezone, priority=item["priority"]["value"],
                     priority_basis=item["priority"]["basis"],
                     status="done" if op == "create_completed" else "todo",
                     blocked_reason=item.get("blocked_reason"), origin_meeting_id=meeting.id,
                     last_meeting_id=meeting.id, approved=True, evidence=evidence)
            session.add(t)
            session.flush()
            session.add(TaskRevision(task_id=t.id, revision=1, snapshot=snapshot(t), change_set_id=cs.id,
                                     meeting_id=meeting.id, actor=actor, reason="created from approved change set"))
            created[item["key"]] = t.code
            tasks_by_key[item["key"]] = t
            record(session, actor, "task", t.code, "create", after=snapshot(t))
            continue

        t = session.exec(select(Task).where(Task.code == item["existing_task_id"])).first()
        if t is None:
            raise ChangeSetError(f"{item['existing_task_id']} no longer exists")
        if revs.get(t.code) is not None and revs[t.code] != t.revision:
            raise ChangeSetError(f"{t.code} changed since this proposal was computed (revision "
                                 f"{revs[t.code]} → {t.revision}); recompute and review again")
        before = snapshot(t)
        if op == "cancel":
            t.status = "cancelled"
            cancelled.append(t.code)
        elif op == "complete":
            t.status = "done"
            completed.append(t.code)
        else:
            t.owner = item["owner"]
            t.owner_certainty = owner_cert
            if deadline.get("date") != t.due_date:
                t.due_date, t.deadline_raw = deadline.get("date"), deadline.get("raw")
                t.deadline_kind = deadline.get("kind", "none")
            if item.get("blocked_reason"):
                t.status, t.blocked_reason = "blocked", item["blocked_reason"]
            # Apply the priority shown in the reviewed proposal unless the organiser set one on the board.
            if item["priority"]["value"] and t.priority_basis not in ("set by organiser",):
                t.priority, t.priority_basis = item["priority"]["value"], item["priority"]["basis"]
            updated.append(t.code)
        t.last_meeting_id = meeting.id
        t.evidence = list(t.evidence) + [e for e in evidence if e not in t.evidence]
        from .tasks import new_revision
        new_revision(session, t, actor, f"{op} from approved change set", cs.id, meeting.id)
        tasks_by_key[item["key"]] = t
        record(session, actor, "task", t.code, op, before=before, after=snapshot(t))

    # Dependencies (between new and/or existing tasks), cycle-protected.
    for item in items:
        t = tasks_by_key.get(item["key"])
        if t is None:
            continue
        for dep in item["depends_on"]:
            pre = tasks_by_key.get(dep["key"]) or (
                session.exec(select(Task).where(Task.code == dep.get("existing_task_id"))).first()
                if dep.get("existing_task_id") else None)
            if pre is not None:
                add_dependency(session, pre, t)

    # In-app calendar entries and reminders shown in the reviewed plan.
    for item in items:
        t = tasks_by_key.get(item["key"])
        if t is None:
            continue
        calendar.upsert_event(session, t, approval.id)
        reminders.schedule_for_task(session, t, approval.id)
        memory.index_task(session, t)

    approved_decisions = []
    for d in cs.proposal.get("decisions_review", []):
        row = session.get(Decision, d["id"])
        if row:
            row.approval_status = "approved" if d.get("include") else "rejected"
            row.text = d["text"]
            session.add(row)
            memory.index_decision(session, row)
            if d.get("include"):
                approved_decisions.append(row.id)
    session.flush()
    return {"created": created, "updated": updated, "cancelled": cancelled, "completed": completed,
            "skipped": skipped, "decisions_approved": approved_decisions, "approval_id": approval.id}
