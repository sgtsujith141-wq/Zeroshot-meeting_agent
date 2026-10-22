"""Pydantic contracts for LLM outputs. Structured output is necessary but not
sufficient: everything here is re-validated semantically (segment IDs, ledger
IDs, owners, dates) before it can influence state."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class EventType(str, Enum):
    PROPOSE = "PROPOSE"
    CONFIRM = "CONFIRM"
    REASSIGN = "REASSIGN"
    CHANGE_DEADLINE = "CHANGE_DEADLINE"
    CANCEL = "CANCEL"
    REJECT = "REJECT"
    ADD_DEPENDENCY = "ADD_DEPENDENCY"
    MARK_BLOCKED = "MARK_BLOCKED"
    REPORT_COMPLETE = "REPORT_COMPLETE"
    DECISION = "DECISION"
    OPEN_QUESTION = "OPEN_QUESTION"


class CommitmentEventOut(BaseModel):
    type: EventType
    segment_ids: list[str] = Field(description="IDs of transcript segments supporting this event")
    task_key: str | None = Field(
        default=None,
        description="Short lowercase key for the work item, reused for every event about the "
        "same work; an existing ledger task ID when the speaker refers to that task",
    )
    title: str | None = Field(default=None, description="Concise description of the work item")
    owner: str | None = Field(
        default=None,
        description="Responsible person as spoken; 'SELF' if the speaker commits personally; "
        "null if no single person is named",
    )
    deadline_text: str | None = Field(
        default=None, description="Exact words of the deadline as spoken; never a converted date"
    )
    strength: Literal["firm", "tentative", "question"] | None = None
    cancel_scope: Literal["task", "assignment", "unclear"] | None = None
    depends_on_key: str | None = Field(
        default=None, description="task_key of the prerequisite work item (ADD_DEPENDENCY)"
    )
    priority: Literal["high", "medium", "low"] | None = Field(
        default=None, description="Only if a priority/urgency was explicitly stated"
    )
    text: str | None = Field(
        default=None, description="Decision or question text (DECISION / OPEN_QUESTION / MARK_BLOCKED reason)"
    )
    rationale: str | None = Field(default=None, description="Stated reason for a DECISION, if any")


class InterpretationOut(BaseModel):
    events: list[CommitmentEventOut]


class BaselineActionOut(BaseModel):
    title: str
    owner: str | None = None
    deadline_text: str | None = None
    due_date: str | None = Field(default=None, description="YYYY-MM-DD or null")
    status: Literal["proposed", "needs_clarification", "tentative", "cancelled", "unclear", "completed"]
    existing_task_id: str | None = None
    depends_on: str | None = Field(default=None, description="Title of the prerequisite action")
    priority: Literal["high", "medium", "low"] | None = None
    clarification_question: str | None = None
    segment_ids: list[str]


class BaselineDecisionOut(BaseModel):
    text: str
    rationale: str | None = None
    segment_ids: list[str]


class BaselineQuestionOut(BaseModel):
    text: str
    segment_ids: list[str]


class BaselineOut(BaseModel):
    action_items: list[BaselineActionOut]
    cancelled_existing_task_ids: list[str] = Field(default_factory=list)
    decisions: list[BaselineDecisionOut] = Field(default_factory=list)
    open_questions: list[BaselineQuestionOut] = Field(default_factory=list)


class MinutesDecisionOut(BaseModel):
    text: str
    rationale: str | None = Field(default=None, description="Reason actually stated; null if none")
    segment_ids: list[str]


class MinutesTopicOut(BaseModel):
    topic: str
    summary: str
    segment_ids: list[str]


class MinutesOut(BaseModel):
    summary: str = Field(description="3-6 sentence factual summary of the meeting")
    discussion: list[MinutesTopicOut]
    decisions: list[MinutesDecisionOut]
    open_questions: list[BaselineQuestionOut]


class GroundedAnswerOut(BaseModel):
    answer: str = Field(description="Answer using ONLY the numbered passages; or 'not found in stored meetings'")
    citations: list[str] = Field(description="Passage IDs that support the answer")
    found: bool


def inline_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema with $refs inlined (portable across Gemini and Ollama)."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return walk(dict(defs[name]))
            out = {}
            for k, v in node.items():
                if k == "properties" and isinstance(v, dict):
                    # property *names* (which may be "title") are kept verbatim
                    out[k] = {pname: walk(pschema) for pname, pschema in v.items()}
                elif k not in ("title", "default"):  # schema metadata only
                    out[k] = walk(v)
            return out
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)
