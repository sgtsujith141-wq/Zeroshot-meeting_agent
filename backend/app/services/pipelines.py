"""The two extraction pipelines compared in the feasibility study.

baseline  : one LLM call -> final action items (LLM resolves owners/dates/state)
candidate : one LLM call -> typed commitment events -> deterministic reconcile()

Both use the same model, generation settings, rules text and evidence checks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .dates import resolve_deadline
from .identity import SpeakerDirectory, is_anonymous_label
from .llm import LLMCall, LLMClient
from .llm_schemas import BaselineOut, InterpretationOut
from .prompts import BASELINE_SYSTEM, CANDIDATE_SYSTEM, build_user_prompt
from .reconcile import LedgerTask, ReconcileContext, ReconcileResult, Segment, reconcile


@dataclass
class CandidateRun:
    interpretation: InterpretationOut
    result: ReconcileResult
    call: LLMCall


@dataclass
class BaselineRun:
    output: BaselineOut
    call: LLMCall


def interpret(llm: LLMClient, meeting_dt: datetime, tz: str, segments: list[Segment],
              ledger: list[LedgerTask], directory: SpeakerDirectory) -> tuple[InterpretationOut, LLMCall]:
    user = build_user_prompt(meeting_dt, tz, segments, ledger, directory)
    return llm.generate_json(CANDIDATE_SYSTEM, user, InterpretationOut, purpose="interpret_events")


def run_candidate(llm: LLMClient, meeting_dt: datetime, tz: str, segments: list[Segment],
                  ledger: list[LedgerTask], directory: SpeakerDirectory) -> CandidateRun:
    interp, call = interpret(llm, meeting_dt, tz, segments, ledger, directory)
    ctx = ReconcileContext(meeting_date=meeting_dt.date(), directory=directory, ledger=ledger)
    return CandidateRun(interp, reconcile(segments, interp.events, ctx), call)


def run_baseline(llm: LLMClient, meeting_dt: datetime, tz: str, segments: list[Segment],
                 ledger: list[LedgerTask], directory: SpeakerDirectory) -> BaselineRun:
    user = build_user_prompt(meeting_dt, tz, segments, ledger, directory)
    out, call = llm.generate_json(BASELINE_SYSTEM, user, BaselineOut, purpose="baseline_extract")
    return BaselineRun(out, call)


ACTIVE_STATES = {"proposed", "needs_clarification"}


def candidate_items(result: ReconcileResult) -> list[dict]:
    """Common evaluation form for candidate output."""
    out = []
    for it in result.items:
        out.append({
            "title": it["title"], "owner": it["owner"], "due_date": it["deadline"]["date"],
            "state": it["state"], "existing_task_id": it["existing_task_id"],
            "operation": it["operation"],
            "blocked_by": [d["title"] for d in it["depends_on"]],
            "evidence": it["evidence_segment_ids"],
        })
    return out


def baseline_items(out: BaselineOut, segments: list[Segment], ledger: list[LedgerTask],
                   meeting_dt: datetime, directory: SpeakerDirectory,
                   deterministic_normalisation: bool = False) -> tuple[list[dict], list[dict]]:
    """Common evaluation form for baseline output, with the same evidence checks
    as the candidate. Returns (items, warnings).

    deterministic_normalisation=True is the ablation "baseline + deterministic
    dates/identity": due dates come from dates.resolve_deadline and anonymous
    owners are cleared, isolating the value of the event fold itself."""
    seg_ids = {s.id for s in segments}
    ledger_ids = {t.task_id for t in ledger}
    items, warnings = [], []
    for n, a in enumerate(out.action_items):
        ev = [s for s in a.segment_ids if s in seg_ids]
        if not ev:
            warnings.append({"kind": "rejected_no_valid_evidence", "index": n, "title": a.title})
            continue
        existing = a.existing_task_id if a.existing_task_id in ledger_ids else None
        if a.existing_task_id and not existing:
            warnings.append({"kind": "unknown_existing_task_id", "index": n, "value": a.existing_task_id})
        state = {"unclear": "held"}.get(a.status, a.status)
        owner, due = a.owner, a.due_date
        if deterministic_normalisation:
            due = resolve_deadline(a.deadline_text, meeting_dt.date()).date if a.deadline_text else None
            if owner and (is_anonymous_label(owner) or owner.lower() in ("self", "i")):
                owner = None
                if state == "proposed":
                    state = "needs_clarification"
        if owner and owner.strip().lower() in ("null", "none", "unknown", ""):
            owner = None
        if state == "proposed" and owner is None and deterministic_normalisation:
            state = "needs_clarification"
        items.append({
            "title": a.title, "owner": owner, "due_date": due, "state": state,
            "existing_task_id": existing,
            "operation": ("cancel" if state == "cancelled" and existing else
                          "complete" if state == "completed" and existing else
                          "update" if existing else "create"),
            "blocked_by": [a.depends_on] if a.depends_on else [],
            "evidence": ev, "clarification_question": a.clarification_question,
        })
    for tid in out.cancelled_existing_task_ids:
        if tid in ledger_ids and not any(i["existing_task_id"] == tid for i in items):
            t = next(t for t in ledger if t.task_id == tid)
            items.append({"title": t.title, "owner": t.owner, "due_date": t.due_date, "state": "cancelled",
                          "existing_task_id": tid, "operation": "cancel", "blocked_by": [], "evidence": []})
    return items, warnings


def baseline_clarifications(items: list[dict]) -> list[str]:
    return [i["clarification_question"] for i in items if i.get("clarification_question")]
