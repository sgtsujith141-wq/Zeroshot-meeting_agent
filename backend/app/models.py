"""Persistent domain model (SQLite via SQLModel). Mirrors the PS 5.3 data contract."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)  # aware UTC (SQLModel stores it normalised to UTC)


def JSONField(default: Any = None) -> Any:  # noqa: N802
    factory = (lambda: list(default)) if isinstance(default, list) else (
        (lambda: dict(default)) if isinstance(default, dict) else (lambda: default))
    return Field(default_factory=factory, sa_column=Column(JSON))


class Meeting(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    scheduled_at: str  # ISO local datetime with offset, e.g. 2026-10-19T10:00:00+05:30
    timezone: str = "Asia/Kolkata"
    organiser: str
    consent_confirmed: bool = False
    consent_confirmed_at: Optional[datetime] = None
    consent_statement: Optional[str] = None
    source_type: Optional[str] = None  # audio | video | transcript
    file_name: Optional[str] = None  # sanitised original name (display only)
    file_path: Optional[str] = None  # internal storage path, never served directly
    file_mime: Optional[str] = None
    file_size: Optional[int] = None
    duration_seconds: Optional[float] = None
    language_hint: Optional[str] = None
    stt_provider: Optional[str] = None
    stt_model: Optional[str] = None
    processing_status: str = "created"
    processing_error: Optional[str] = None
    processing_log: list = JSONField([])
    minutes: dict = JSONField({})
    created_at: datetime = Field(default_factory=utcnow)


class Participant(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("meeting_id", "speaker_label"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    speaker_label: str
    display_name: Optional[str] = None
    confirmed_identity: bool = False


class TranscriptSegment(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("meeting_id", "seg_key"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    seg_key: str  # stable per-meeting id cited as evidence, e.g. "s12"
    order_index: int
    speaker_label: str
    start_seconds: float
    end_seconds: Optional[float] = None
    text: str
    revision: int = 1
    source_type: str  # stt:sarvam | import:json | import:text | import:vtt | import:sarvam_json


class LLMRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: Optional[int] = Field(default=None, foreign_key="meeting.id", index=True)
    purpose: str
    provider: str
    model: str
    temperature: float
    seed: Optional[int] = None
    latency_ms: int = 0
    attempts: int = 0
    usage: dict = JSONField({})
    raw_text: str = ""
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class CommitmentEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    llm_run_id: Optional[int] = Field(default=None, foreign_key="llmrun.id")
    seq: int
    type: str
    task_key: Optional[str] = None
    payload: dict = JSONField({})
    segment_ids: list = JSONField([])
    target_task_id: Optional[str] = None
    interpretation_status: str = "valid"  # valid | rejected
    rejection_reason: Optional[str] = None


class Decision(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    text: str
    rationale: Optional[str] = None
    evidence_segment_ids: list = JSONField([])
    approval_status: str = "proposed"  # proposed | approved | rejected
    source: str = "minutes"


class OpenQuestion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    text: str
    evidence_segment_ids: list = JSONField([])
    status: str = "open"  # open | resolved


class ChangeSet(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    # DRAFT | NEEDS_CLARIFICATION | READY_FOR_REVIEW | APPROVED | REJECTED | APPLIED | FAILED
    state: str = "DRAFT"
    version: int = 1
    proposal: dict = JSONField({})  # reconcile() output after organiser overlay
    base_result: dict = JSONField({})  # raw reconcile() output (before overlay)
    ledger_snapshot: list = JSONField([])  # approved tasks (id, revision) the proposal is based on
    organizer_edits: dict = JSONField({})  # {"items": {key: {...}}, "answers": {"key|kind": {...}}}
    proposal_hash: str = ""
    applied_result: dict = JSONField({})
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)  # TASK-1, TASK-2 ...
    title: str
    deliverable: Optional[str] = None
    owner: Optional[str] = None
    owner_certainty: str = "named"  # confirmed | named | inferred_from_speaker
    due_date: Optional[str] = None  # ISO date (local), no invented clock time
    deadline_raw: Optional[str] = None
    deadline_kind: str = "none"  # explicit | derived | unknown | none | set_by_organiser
    timezone: str = "Asia/Kolkata"
    priority: Optional[str] = None
    priority_basis: Optional[str] = None
    status: str = "todo"  # todo | in_progress | blocked | done | cancelled
    blocked_reason: Optional[str] = None
    revision: int = 1
    origin_meeting_id: int = Field(foreign_key="meeting.id")
    last_meeting_id: Optional[int] = None
    approved: bool = True
    evidence: list = JSONField([])  # [{"meeting_id": 1, "seg_key": "s3"}]
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class TaskRevision(SQLModel, table=True):
    """Immutable snapshot of every approved revision of a task."""
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    revision: int
    snapshot: dict = JSONField({})
    change_set_id: Optional[int] = None
    meeting_id: Optional[int] = None
    actor: str
    reason: str
    created_at: datetime = Field(default_factory=utcnow)


class TaskDependency(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("prerequisite_task_id", "dependent_task_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    prerequisite_task_id: int = Field(foreign_key="task.id", index=True)
    dependent_task_id: int = Field(foreign_key="task.id", index=True)
    type: str = "finish_to_start"


class Approval(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("scope", "snapshot_hash"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    scope: str  # changeset:<id> | reminder:<id> | summary:<id>
    decision: str = "approved"  # approved | rejected
    snapshot_hash: str
    snapshot: dict = JSONField({})
    approved_at: datetime = Field(default_factory=utcnow)


class CalendarEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True, unique=True)
    uid: str
    title: str
    date: str  # all-day event on the local due date
    timezone: str
    sync_state: str = "local"  # local | exported (ics downloaded) | synced (real external API only)
    external_provider: Optional[str] = None
    external_id: Optional[str] = None
    approval_id: Optional[int] = None
    sequence: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    scheduled_at: datetime  # aware UTC
    channel: str = "in_app"  # in_app | email
    recipients: list = JSONField([])
    message: str
    approval_id: Optional[int] = None
    delivery_state: str = "scheduled"  # draft | scheduled | delivered | failed | cancelled
    attempts: int = 0
    last_error: Optional[str] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class Notification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    reminder_id: Optional[int] = Field(default=None, foreign_key="reminder.id")
    task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    message: str
    read: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class SummaryShare(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meeting.id", index=True)
    content: str
    channel: str = "copy"  # copy | email
    recipients: list = JSONField([])
    state: str = "prepared"  # prepared | approved | sent | failed
    approval_id: Optional[int] = None
    sent_at: Optional[datetime] = None
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class ExternalSync(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    operation_id: str
    idempotency_key: str = Field(unique=True, index=True)
    provider: str
    external_id: Optional[str] = None
    request_state: str = "pending"  # pending | done | failed
    detail: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class AuditEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    object_type: str
    object_id: str
    action: str
    before: dict = JSONField({})
    after: dict = JSONField({})
    result: str = "ok"
    created_at: datetime = Field(default_factory=utcnow)
