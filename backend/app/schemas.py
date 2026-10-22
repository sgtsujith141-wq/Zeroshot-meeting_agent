"""API request models (validation at the boundary)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


def _tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown timezone '{v}'") from exc
    return v


def _iso_date(v: str | None) -> str | None:
    if v in (None, ""):
        return None
    date.fromisoformat(v)
    return v


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    scheduled_at: str = Field(description="ISO datetime; offset optional (meeting timezone is applied)")
    timezone: str = "Asia/Kolkata"
    consent_confirmed: bool = Field(description="Organiser attests every participant consented")
    consent_statement: str | None = Field(default=None, max_length=1000)
    language_hint: str | None = Field(default=None, max_length=40)

    @field_validator("timezone")
    @classmethod
    def _tzv(cls, v: str) -> str:
        return _tz(v)

    @field_validator("scheduled_at")
    @classmethod
    def _dt(cls, v: str) -> str:
        datetime.fromisoformat(v)
        return v

    @field_validator("consent_confirmed")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if not v:
            raise ValueError("organiser must confirm participant consent before a meeting is created")
        return v


class ProcessRequest(BaseModel):
    steps: list[Literal["transcribe", "interpret", "minutes"]] = ["transcribe", "interpret", "minutes"]


class ParticipantUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)
    confirmed_identity: bool = True


class SegmentUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class Answer(BaseModel):
    choice: str = Field(max_length=40)
    value: str | None = Field(default=None, max_length=200)


class ItemEdit(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    deliverable: str | None = Field(default=None, max_length=500)
    owner: str | None = Field(default=None, max_length=80)
    due_date: str | None = None
    priority: Literal["high", "medium", "low"] | None = None
    excluded: bool | None = None
    promote: bool | None = None
    drop_dependencies: list[str] | None = Field(default=None, max_length=50)

    @field_validator("due_date")
    @classmethod
    def _d(cls, v: str | None) -> str | None:
        return _iso_date(v)


class DecisionEdit(BaseModel):
    include: bool | None = None
    text: str | None = Field(default=None, max_length=1000)


class ChangeSetPatch(BaseModel):
    answers: dict[str, Answer | None] = {}
    items: dict[str, dict] = {}
    decisions: dict[str, DecisionEdit] = {}

    @field_validator("items")
    @classmethod
    def _items(cls, v: dict) -> dict:
        return {k: ItemEdit.model_validate(e).model_dump(exclude_unset=True) for k, e in v.items()}


class ApproveRequest(BaseModel):
    proposal_hash: str = Field(min_length=64, max_length=64)


class RejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class TaskPatch(BaseModel):
    expected_revision: int
    status: Literal["todo", "in_progress", "blocked", "done", "cancelled"] | None = None
    owner: str | None = Field(default=None, max_length=80)
    due_date: str | None = None
    priority: Literal["high", "medium", "low"] | None = None
    blocked_reason: str | None = Field(default=None, max_length=300)
    title: str | None = Field(default=None, max_length=300)

    @field_validator("due_date")
    @classmethod
    def _d(cls, v: str | None) -> str | None:
        return _iso_date(v)


class DependencyCreate(BaseModel):
    prerequisite_code: str = Field(pattern=r"^TASK-\d+$")


class ReminderCreate(BaseModel):
    task_code: str = Field(pattern=r"^TASK-\d+$")
    scheduled_at: str = Field(description="ISO datetime with offset, or naive = task timezone")
    channel: Literal["in_app", "email"] = "in_app"
    recipients: list[str] = Field(default_factory=list, max_length=20)
    message: str | None = Field(default=None, max_length=1000)

    @field_validator("scheduled_at")
    @classmethod
    def _dt(cls, v: str) -> str:
        datetime.fromisoformat(v)
        return v


class SummaryApprove(BaseModel):
    channel: Literal["copy", "email"] = "copy"
    recipients: list[str] = Field(default_factory=list, max_length=50)
    content_hash: str = Field(min_length=64, max_length=64)


class MemoryQuery(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    use_llm: bool = True


class EvalRunRequest(BaseModel):
    provider: Literal["gemini", "ollama"] | None = None
    model: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9._:/-]+$")
    cases: list[str] = Field(default_factory=list, max_length=20)
