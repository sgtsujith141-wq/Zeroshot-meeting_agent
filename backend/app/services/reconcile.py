"""Commitment Reconciliation Engine: deterministic fold of LLM-interpreted events.

Input : validated, chronologically ordered commitment events + the approved task
        ledger + speaker directory + meeting date.
Output: proposed operations (create / update / cancel / complete / hold / suggest),
        a ranked minimal list of clarification questions, decisions and open
        questions, plus a provenance history for every item.

This module never touches the database and never calls an LLM. The same events
always produce the same result, so re-running it after the organiser maps a
speaker or answers a question is cheap and reproducible.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date

from .dates import DeadlineInfo, resolve_deadline
from .identity import OwnerResolution, SpeakerDirectory, resolve_owner
from .llm_schemas import CommitmentEventOut, EventType
from .similarity import content_tokens, title_similarity


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

@dataclass
class Segment:
    id: str
    speaker: str
    start: float
    text: str
    end: float | None = None


@dataclass
class LedgerTask:
    task_id: str
    title: str
    owner: str | None = None
    due_date: str | None = None
    status: str = "approved"
    depends_on: list[str] = field(default_factory=list)


@dataclass
class ReconcileContext:
    meeting_date: date
    directory: SpeakerDirectory
    ledger: list[LedgerTask] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Issue taxonomy and deterministic ranking (lower rank = asked first)
# ---------------------------------------------------------------------------

# Issues that make the existence/identity of the work (or of a change to an
# approved task) uncertain. Items carrying one are "held": nothing is created or
# patched, and their lower-ranked questions are deferred until it is answered.
EXISTENCE_ISSUES = {
    "possible_existing_match", "ambiguous_reference", "unverified_reference",
    "ambiguous_cancellation_new", "ambiguous_cancellation_existing", "instruction_to_assistant",
}
ISSUE_RANK = {
    # 1: blocks creation (does the task exist / which task is it?)
    "instruction_to_assistant": 1, "ambiguous_reference": 1, "unverified_reference": 1,
    "possible_existing_match": 1, "ambiguous_cancellation_new": 1,
    # 2: ambiguous cancellation / reassignment of work
    "ambiguous_cancellation_existing": 2, "pending_acceptance": 2,
    # 3: ownership and prerequisites
    "unmapped_speaker": 3, "group_owner": 3, "missing_owner": 3, "missing_prerequisite": 3,
    # 4: deadlines
    "ambiguous_deadline": 4,
}

# Words that make "cancel the X" ambiguous between cancelling the work and
# cancelling only one plan/approach for it (brief section 5).
SCOPE_QUALIFIERS = re.compile(
    r"\b(plan|plans|approach|old|previous|version|idea|process|method|strategy|way|draft|proposal)\b",
    re.I,
)
ASSISTANT_DIRECTED = re.compile(
    r"\b(assistant|chatbot|bot|ai|agent|copilot|gemini|claude|chatgpt)\b\s*[,:]?.{0,80}?\b"
    r"(ignore|skip|bypass|send|email|e-mail|message|delete|approve|override|forward)\b",
    re.I,
)
IGNORE_INSTRUCTIONS = re.compile(
    r"\b(ignore|disregard|bypass|skip)\b.{0,40}\b(instruction|instructions|approval|approvals|rules|screen|review|previous)\b",
    re.I,
)
# "once the refund API is ready", "only after the backend API is finished",
# "API ready aadmele" (Kannada: after it becomes), "API ke baad" (Hindi: after).
DEP_CUE = re.compile(
    r"\b(?:once|after|only after|as soon as|when)\s+(?P<x>[^,.;]{2,80}?)\s+(?:is|are|has been|have been|gets|get)?\s*"
    r"(?:ready|done|finished|complete|completed|merged|approved|signed off|deployed|live|in place)\b", re.I)
DEP_CUE_IN = re.compile(
    r"(?P<x>[A-Za-z][\w' ]{1,60}?)\s+(?:ready|done|finish|complete|merge)?\s*(?:aadmele|aadamele|aada mele|aadhmele|ke baad|hone ke baad)\b",
    re.I)
FIRST_PERSON = re.compile(r"\b(i|i'll|i will|i can|i'm|me|naanu|nanu|main|mein)\b", re.I)


def injection_markers(segments: list[Segment]) -> dict[str, str]:
    out = {}
    for s in segments:
        if ASSISTANT_DIRECTED.search(s.text) or IGNORE_INSTRUCTIONS.search(s.text):
            out[s.id] = "segment addresses the assistant / tries to bypass review; treated as data"
    return out


def norm_key(value: str | None) -> str | None:
    if not value:
        return None
    k = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return k or None


# ---------------------------------------------------------------------------
# Working state
# ---------------------------------------------------------------------------

@dataclass
class Issue:
    kind: str
    detail: str
    segment_ids: list[str]
    data: dict = field(default_factory=dict)


@dataclass
class Draft:
    key: str
    title: str | None
    order: int
    existing_task_id: str | None = None
    before: dict | None = None
    status: str = "proposed"  # tentative | proposed | cancelled | rejected | completed
    confirmed: bool = False
    owner: OwnerResolution = field(default_factory=lambda: OwnerResolution(None, "missing"))
    owner_candidate: str | None = None
    owner_changed: bool = False
    deadline: DeadlineInfo = field(default_factory=DeadlineInfo)
    deadline_changed: bool = False
    priority_stated: str | None = None
    depends_on: list[str] = field(default_factory=list)
    blocked_reason: str | None = None
    evidence: list[str] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    pending_unclear_cancel: bool = False

    def add_evidence(self, seg_ids: list[str]) -> None:
        for s in seg_ids:
            if s not in self.evidence:
                self.evidence.append(s)

    def add_issue(self, issue: Issue) -> None:
        if not any(i.kind == issue.kind and i.detail == issue.detail for i in self.issues):
            self.issues.append(issue)

    def clear_issues(self, *kinds: str) -> None:
        self.issues = [i for i in self.issues if i.kind not in kinds]


@dataclass
class ReconcileResult:
    items: list[dict]
    clarifications: list[dict]
    decisions: list[dict]
    open_questions: list[dict]
    rejected_events: list[dict]
    warnings: list[dict]
    uncovered_segment_ids: list[str] = field(default_factory=list)
    fingerprint: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class Reconciler:
    def __init__(self, segments: list[Segment], ctx: ReconcileContext):
        self.segments = segments
        self.seg_index = {s.id: i for i, s in enumerate(segments)}
        self.seg_by_id = {s.id: s for s in segments}
        self.ctx = ctx
        self.ledger = {t.task_id: t for t in ctx.ledger}
        self.ledger_by_norm = {norm_key(t.task_id): t.task_id for t in ctx.ledger}
        self.drafts: dict[str, Draft] = {}
        self.decisions: list[dict] = []
        self.open_questions: list[dict] = []
        self.rejected: list[dict] = []
        self.warnings: list[dict] = []
        self._last_target: Draft | None = None
        self.injected = injection_markers(segments)
        for sid, why in self.injected.items():
            self.warnings.append({"kind": "possible_prompt_injection", "segment_ids": [sid], "detail": why})

    # -- validation -----------------------------------------------------------
    def _validate(self, n: int, ev: CommitmentEventOut) -> CommitmentEventOut | None:
        valid = [s for s in ev.segment_ids if s in self.seg_index]
        invalid = [s for s in ev.segment_ids if s not in self.seg_index]
        if not valid:
            self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                  "reason": f"no valid evidence segment ids (got {ev.segment_ids})"})
            return None
        if invalid:
            self.warnings.append({"kind": "dropped_invalid_segment_ids", "segment_ids": valid,
                                  "detail": f"event {n} cited nonexistent segments {invalid}"})
        valid.sort(key=lambda s: self.seg_index[s])
        if ev.deadline_text and not self._spoken_in(ev.deadline_text, valid):
            # The deadline must be words actually spoken in the cited segments; a date the
            # model copied from the ledger or invented is not evidence.
            self.warnings.append({"kind": "deadline_not_in_evidence", "segment_ids": valid,
                                  "detail": f"event {n}: deadline “{ev.deadline_text}” does not occur in the cited "
                                            "speech; ignored"})
            if ev.type == EventType.CHANGE_DEADLINE:
                self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                      "reason": "CHANGE_DEADLINE words not found in cited speech"})
                return None
            ev = ev.model_copy(update={"deadline_text": None})
        needs_task = ev.type not in (EventType.DECISION, EventType.OPEN_QUESTION)
        if ev.type in (EventType.CANCEL, EventType.REJECT) and not (ev.task_key or ev.title):
            # A cancellation with no stated target is never dropped silently: ask what it cancels.
            self.warnings.append({"kind": "unmatched_cancellation", "segment_ids": valid,
                                  "detail": f"event {n}: a cancellation without a target; nothing changed"})
            self.open_questions.append({"text": f"What exactly is cancelled by: “{self._cited_text(valid)}”?",
                                        "segment_ids": valid})
            return None
        if needs_task and not (ev.task_key or ev.title):
            self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                  "reason": "event has neither task_key nor title"})
            return None
        if ev.type == EventType.REASSIGN and not ev.owner:
            self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                  "reason": "REASSIGN without a new owner"})
            return None
        if ev.type == EventType.CHANGE_DEADLINE and not ev.deadline_text:
            self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                  "reason": "CHANGE_DEADLINE without deadline words"})
            return None
        if ev.type == EventType.ADD_DEPENDENCY and not ev.depends_on_key:
            self.rejected.append({"index": n, "event": ev.model_dump(mode="json"),
                                  "reason": "ADD_DEPENDENCY without a prerequisite"})
            return None
        return ev.model_copy(update={"segment_ids": valid})

    def _spoken_in(self, phrase: str, seg_ids: list[str]) -> bool:
        words = lambda t: set(re.findall(r"[^\W_]+", t.lower()))  # noqa: E731
        want = {w for w in words(phrase) if len(w) > 1}
        have = words(" ".join(self.seg_by_id[s].text for s in seg_ids))
        return not want or len(want & have) / len(want) >= 0.6

    def _speaker_for(self, ev: CommitmentEventOut) -> str | None:
        segs = [self.seg_by_id[s] for s in ev.segment_ids]
        speakers = {s.speaker for s in segs}
        if len(speakers) == 1:
            return segs[0].speaker
        for s in reversed(segs):
            if FIRST_PERSON.search(s.text):
                return s.speaker
        return segs[-1].speaker

    def _cited_text(self, seg_ids: list[str]) -> str:
        return " ".join(self.seg_by_id[s].text for s in seg_ids)

    # -- target resolution ----------------------------------------------------
    def _existing_draft(self, task_id: str, ev: CommitmentEventOut) -> Draft:
        if task_id in self.drafts:
            return self.drafts[task_id]
        t = self.ledger[task_id]
        d = Draft(key=task_id, title=t.title, order=self.seg_index[ev.segment_ids[0]],
                  existing_task_id=task_id,
                  before={"title": t.title, "owner": t.owner, "due_date": t.due_date,
                          "status": t.status, "depends_on": list(t.depends_on)},
                  status="proposed", confirmed=True,
                  owner=OwnerResolution(t.owner, "named" if t.owner else "missing"),
                  deadline=DeadlineInfo(raw=t.due_date, date=t.due_date,
                                        kind="explicit" if t.due_date else "none"),
                  depends_on=list(t.depends_on))
        cited = self._cited_text(ev.segment_ids)
        if task_id.lower() not in cited.lower() and not (content_tokens(cited) & content_tokens(t.title)):
            d.add_issue(Issue("unverified_reference",
                              f"Linked to existing {task_id} “{t.title}”, but the cited speech does not mention it",
                              ev.segment_ids, {"task_id": task_id}))
        self.drafts[task_id] = d
        return d

    def _ledger_candidates(self, title: str | None, key: str | None) -> list[str]:
        probe = title or (key or "").replace("-", " ")
        ta = content_tokens(probe)
        out = []
        for t in self.ctx.ledger:
            tb = content_tokens(t.title)
            if not ta or not tb:
                continue
            inter = len(ta & tb)
            if inter and (inter / min(len(ta), len(tb)) == 1.0 or inter / len(ta | tb) >= 0.5):
                out.append(t.task_id)
        return out

    def _new_draft(self, key: str | None, ev: CommitmentEventOut) -> Draft:
        key = key or f"item-{len(self.drafts) + 1}"
        while key in self.drafts:
            key = f"{key}-{len(self.drafts) + 1}"
        d = Draft(key=key, title=ev.title or (ev.task_key or "").replace("-", " "),
                  order=self.seg_index[ev.segment_ids[0]])
        self.drafts[d.key] = d
        return d

    def _resolve_target(self, ev: CommitmentEventOut, mode: str) -> Draft | None:
        """mode: 'propose' (may create), 'modify' (presupposes an item; may create
        if nothing matches) or 'destructive' (cancel/reject: never creates)."""
        key = norm_key(ev.task_key) or norm_key(ev.title)
        if key in self.ledger_by_norm:
            return self._existing_draft(self.ledger_by_norm[key], ev)
        if key in self.drafts:
            return self.drafts[key]
        probe = ev.title or (ev.task_key or "").replace("-", " ")
        tokens = content_tokens(probe)
        if tokens:
            # Same work item under a slightly different key: identical content tokens.
            # A *new proposal* never merges into an approved ledger task by title alone.
            same = [d for d in self.drafts.values()
                    if (mode != "propose" or not d.existing_task_id)
                    and (content_tokens(d.title) == tokens or content_tokens(d.key.replace("-", " ")) == tokens)]
            if len(same) == 1:
                return same[0]
        if mode == "propose":
            return self._new_draft(key, ev)

        close = [d for d in self.drafts.values()
                 if title_similarity(probe, d.title or d.key.replace("-", " ")) >= 0.5] if tokens else []
        if len(close) == 1:
            return close[0]
        if len(close) > 1:
            target = close[0]
            target.add_issue(Issue("ambiguous_reference",
                                   f"“{probe}” could refer to several items: "
                                   + ", ".join(f"“{d.title or d.key}”" for d in close),
                                   ev.segment_ids, {"candidates": [d.key for d in close]}))
            return target
        cands = self._ledger_candidates(ev.title, ev.task_key)
        if len(cands) == 1:
            d = self._existing_draft(cands[0], ev)
            d.history.append({"type": "MATCH", "segment_ids": ev.segment_ids,
                              "summary": f"“{probe}” matched existing {cands[0]} by title (single candidate)"})
            return d
        if len(cands) > 1:
            if mode == "destructive":
                self.warnings.append({"kind": "ambiguous_reference", "segment_ids": ev.segment_ids,
                                      "detail": f"“{probe}” matches several approved tasks {cands}; nothing changed"})
                return None
            d = self._new_draft(key, ev)
            d.add_issue(Issue("ambiguous_reference",
                              f"“{probe}” could refer to existing tasks "
                              + ", ".join(f"{c} “{self.ledger[c].title}”" for c in cands)
                              + " — which one, or is it new?", ev.segment_ids, {"candidates": cands}))
            return d
        if mode == "destructive":
            return None
        return self._new_draft(key, ev)

    # -- event application ------------------------------------------------------
    def _log(self, d: Draft, ev: CommitmentEventOut, summary: str) -> None:
        d.history.append({"type": ev.type.value, "summary": summary, "segment_ids": ev.segment_ids})
        d.add_evidence(ev.segment_ids)

    def _set_owner(self, d: Draft, owner_raw: str, speaker: str | None, ev: CommitmentEventOut,
                   verb: str) -> None:
        res = resolve_owner(owner_raw, speaker, self.ctx.directory)
        before = d.owner.name or (d.owner.unmapped_label and f"[{d.owner.unmapped_label}]") or "unassigned"
        after = res.name or (res.unmapped_label and f"[{res.unmapped_label}]") or "unassigned"
        if (ev.strength == "question" and res.name) and ev.type != EventType.CONFIRM:
            d.owner_candidate = res.name
            self._log(d, ev, f"{res.name} asked to take it (not yet accepted)")
            return
        if before != after and d.owner.status != "missing":
            d.owner_changed = True
        if before != after and d.existing_task_id:
            d.owner_changed = True
        d.owner = res
        d.owner_candidate = None
        d.clear_issues("pending_acceptance")
        self._log(d, ev, f"{verb}: owner {before} → {after}" if before != after else f"{verb}: owner {after}")

    def _set_deadline(self, d: Draft, raw: str, ev: CommitmentEventOut, verb: str) -> None:
        info = resolve_deadline(raw, self.ctx.meeting_date)
        before = d.deadline.date or d.deadline.raw or "none"
        if d.deadline.kind != "none" and (info.date != d.deadline.date or info.raw != d.deadline.raw):
            d.deadline_changed = True
        if d.existing_task_id and info.date != d.deadline.date:
            d.deadline_changed = True
        d.deadline = info
        self._log(d, ev, f"{verb}: deadline {before} → {info.date or info.raw}")

    def apply(self, ev: CommitmentEventOut) -> None:
        speaker = self._speaker_for(ev)
        self._last_target = None
        self._apply_type(ev, speaker)
        # A prerequisite stated on any work-item event (not only ADD_DEPENDENCY) is honoured.
        if (ev.depends_on_key and ev.type in (EventType.PROPOSE, EventType.CONFIRM, EventType.REASSIGN,
                                              EventType.CHANGE_DEADLINE)):
            d = self._last_target
            if d is not None and d.status not in ("cancelled", "rejected"):
                self._add_dependency(d, ev)

    def _apply_type(self, ev: CommitmentEventOut, speaker: str | None) -> None:
        t = ev.type
        if t == EventType.DECISION:
            self.decisions.append({"text": ev.text or ev.title or "", "rationale": ev.rationale,
                                   "segment_ids": ev.segment_ids})
            return
        if t == EventType.OPEN_QUESTION:
            self.open_questions.append({"text": ev.text or ev.title or "", "segment_ids": ev.segment_ids})
            return

        mode = ("propose" if t == EventType.PROPOSE else
                "destructive" if t in (EventType.CANCEL, EventType.REJECT) else "modify")
        d = self._resolve_target(ev, mode)
        self._last_target = d
        if d is None:
            if t in (EventType.CANCEL, EventType.REJECT):
                self.warnings.append({"kind": "unmatched_cancellation", "segment_ids": ev.segment_ids,
                                      "detail": f"“{ev.title or ev.task_key}” cancelled/rejected but no "
                                      "single matching item; nothing changed"})
                self.open_questions.append({
                    "text": f"What exactly is cancelled by: “{self._cited_text(ev.segment_ids)}”?",
                    "segment_ids": ev.segment_ids})
            else:
                self.rejected.append({"index": -1, "event": ev.model_dump(mode="json"),
                                      "reason": "could not resolve target work item"})
            return

        if t == EventType.PROPOSE:
            fresh = not d.history and not d.existing_task_id
            if d.status in ("cancelled", "rejected") and not d.existing_task_id:
                d.status = "proposed"
                self._log(d, ev, "re-proposed after cancellation")
            if ev.strength == "firm" and d.status == "tentative":
                d.status = "proposed"
            elif fresh:
                d.status = "tentative" if ev.strength in ("tentative", "question") and not ev.owner else (
                    "tentative" if ev.strength == "tentative" else "proposed")
            if ev.title and not d.title:
                d.title = ev.title
            self._log(d, ev, f"proposed ({ev.strength or 'unspecified'})" if fresh else "restated")
            if ev.owner:
                res = resolve_owner(ev.owner, speaker, self.ctx.directory)
                if not fresh and d.owner.name and res.status in ("group", "missing"):
                    # A restatement with an unclear owner never erases a clear earlier assignment.
                    self._log(d, ev, f"restated with unclear owner “{ev.owner}”; kept {d.owner.name}")
                else:
                    self._set_owner(d, ev.owner, speaker, ev, "assigned" if fresh else "restated")
            if ev.deadline_text:
                self._set_deadline(d, ev.deadline_text, ev, "deadline" if fresh else "restated")
            if ev.priority:
                d.priority_stated = ev.priority
            return

        if t == EventType.CONFIRM:
            if d.status in ("cancelled", "rejected") and not d.existing_task_id:
                d.status = "proposed"
                self._log(d, ev, "revived by later confirmation")
            elif d.status == "tentative":
                d.status = "proposed"
            d.confirmed = True
            spk_name = self.ctx.directory.name_for(speaker)
            if ev.owner:
                self._set_owner(d, ev.owner, speaker, ev, "confirmed")
            elif d.owner_candidate and spk_name == d.owner_candidate:
                self._set_owner(d, "SELF", speaker, ev, "accepted")
            else:
                self._log(d, ev, f"confirmed by {spk_name or speaker}")
            if ev.deadline_text and ev.deadline_text != d.deadline.raw:
                self._set_deadline(d, ev.deadline_text, ev, "confirmed")
            return

        if t == EventType.REASSIGN:
            if d.status == "tentative" and ev.strength == "firm":
                d.status = "proposed"
            self._set_owner(d, ev.owner or "", speaker, ev, "reassigned")
            if ev.deadline_text:
                self._set_deadline(d, ev.deadline_text, ev, "reassigned")
            return

        if t == EventType.CHANGE_DEADLINE:
            self._set_deadline(d, ev.deadline_text or "", ev, "deadline changed")
            return

        if t in (EventType.CANCEL, EventType.REJECT):
            cited = self._cited_text(ev.segment_ids)
            # Unstated scope: approved work defaults to "unclear"; an unapproved
            # proposal is simply withdrawn (reviewable, non-destructive).
            scope = ev.cancel_scope or ("unclear" if d.existing_task_id and t == EventType.CANCEL else "task")
            if d.existing_task_id:
                # Destructive change to approved work: require an unambiguous scope.
                if scope == "task" and (t == EventType.REJECT or SCOPE_QUALIFIERS.search(cited)):
                    scope = "unclear"
                if scope == "unclear":
                    d.pending_unclear_cancel = True
                    d.add_issue(Issue("ambiguous_cancellation_existing",
                                      f"“{cited}” — cancel the whole task {d.existing_task_id} "
                                      f"“{d.title}”, or only a plan/part of it while the task continues?",
                                      ev.segment_ids, {"task_id": d.existing_task_id}))
                    self._log(d, ev, "cancellation scope unclear; existing task left unchanged")
                    return
            if scope == "assignment":
                prev = d.owner.name or d.owner.unmapped_label or "unassigned"
                d.owner = OwnerResolution(None, "missing", note=f"{prev} removed from this assignment")
                d.owner_candidate = None
                d.owner_changed = True
                self._log(d, ev, f"assignment cancelled ({prev} removed); work continues")
                return
            if scope == "unclear":
                d.add_issue(Issue("ambiguous_cancellation_new",
                                  f"“{cited}” — is “{d.title}” cancelled entirely, or only part of it?",
                                  ev.segment_ids, {}))
                self._log(d, ev, "cancellation scope unclear")
                return
            d.status = "cancelled" if t == EventType.CANCEL else "rejected"
            d.clear_issues("ambiguous_cancellation_new")
            self._log(d, ev, "cancelled" if t == EventType.CANCEL else "rejected")
            return

        if t == EventType.ADD_DEPENDENCY:
            self._add_dependency(d, ev)
            return

        if t == EventType.MARK_BLOCKED:
            d.blocked_reason = ev.text or "blocked (reason not stated)"
            self._log(d, ev, f"blocked: {d.blocked_reason}")
            return

        if t == EventType.REPORT_COMPLETE:
            d.status = "completed"
            self._log(d, ev, "reported complete (spoken report; verify before closing)")
            return

    def _add_dependency(self, d: Draft, ev: CommitmentEventOut) -> None:
        prereq = self._resolve_prereq(ev)
        if prereq is None:
            d.add_issue(Issue("missing_prerequisite",
                              f"“{d.title}” depends on “{ev.depends_on_key}”, which is not a known task",
                              ev.segment_ids, {"depends_on": ev.depends_on_key}))
            self._log(d, ev, f"depends on unknown “{ev.depends_on_key}”")
            return
        if prereq == d.key or self._reaches(prereq, d.key):
            self.warnings.append({"kind": "dependency_cycle_rejected", "segment_ids": ev.segment_ids,
                                  "detail": f"{d.key} → {prereq} would create a cycle"})
            return
        if prereq not in d.depends_on:
            d.depends_on.append(prereq)
        self._log(d, ev, f"depends on {prereq}")

    def _resolve_prereq(self, ev: CommitmentEventOut) -> str | None:
        key = norm_key(ev.depends_on_key)
        if key in self.ledger_by_norm:
            return self.ledger_by_norm[key]
        if key in self.drafts:
            return key
        probe = (ev.depends_on_key or "").replace("-", " ")
        scored = [(title_similarity(probe, d.title or d.key.replace("-", " ")), k)
                  for k, d in self.drafts.items()]
        scored += [(title_similarity(probe, t.title), t.task_id) for t in self.ctx.ledger]
        scored = [s for s in scored if s[0] >= 0.5]
        if len(scored) == 1:
            return scored[0][1]
        if len(scored) > 1:
            scored.sort(reverse=True)
            if scored[0][0] > scored[1][0]:
                return scored[0][1]
        return None

    def _deps_of(self, key: str) -> list[str]:
        if key in self.drafts:
            return self.drafts[key].depends_on
        if key in self.ledger:
            return self.ledger[key].depends_on
        return []

    def _reaches(self, start: str, target: str) -> bool:
        seen, stack = set(), [start]
        while stack:
            k = stack.pop()
            if k == target:
                return True
            if k in seen:
                continue
            seen.add(k)
            stack.extend(self._deps_of(k))
        return False

    # -- final derivation -------------------------------------------------------
    def _finalise_draft(self, d: Draft) -> None:
        if d.status in ("cancelled", "rejected", "completed", "tentative"):
            return
        if d.evidence and all(s in self.injected for s in d.evidence) and not d.existing_task_id:
            d.add_issue(Issue("instruction_to_assistant",
                              f"“{d.title}” comes only from speech addressed to the assistant; "
                              "transcript text cannot authorise actions. Is this a genuine team action?",
                              d.evidence, {}))
        if not d.existing_task_id and not any(i.kind == "possible_existing_match" for i in d.issues):
            cands = self._ledger_candidates(d.title, d.key)
            if cands:
                titles = ", ".join(f"{c} “{self.ledger[c].title}”" for c in cands)
                d.add_issue(Issue("possible_existing_match",
                                  f"Is “{d.title}” the existing task {titles} (update it) or a new task?",
                                  d.evidence[:1], {"candidates": cands}))
        if d.owner_candidate and not d.owner.name:
            d.add_issue(Issue("pending_acceptance",
                              f"{d.owner_candidate} was asked to take “{d.title}” — did they accept?",
                              d.evidence[-1:], {"candidate": d.owner_candidate}))
        elif not d.owner.name:
            if d.owner.needs_identity:
                label = d.owner.unmapped_label
                d.add_issue(Issue("unmapped_speaker",
                                  f"Who is {label}? They are the owner of “{d.title}”. Map {label} to a "
                                  "participant to assign it.", d.evidence[:1], {"speaker_label": label}))
            elif d.owner.status == "group":
                d.add_issue(Issue("group_owner",
                                  f"Which single person owns “{d.title}”? ({d.owner.note})",
                                  d.evidence[:1], {}))
            else:
                note = f" ({d.owner.note})" if d.owner.note else ""
                d.add_issue(Issue("missing_owner", f"Who owns “{d.title}”?{note}", d.evidence[:1], {}))
        if d.deadline.ambiguous:
            cands = f" Candidates: {', '.join(d.deadline.candidates)}." if d.deadline.candidates else ""
            d.add_issue(Issue("ambiguous_deadline",
                              f"Deadline “{d.deadline.raw}” for “{d.title}” is unclear "
                              f"({d.deadline.note}).{cands}", d.evidence[:1],
                              {"candidates": d.deadline.candidates}))
        for dep in d.depends_on:
            pd = self.drafts.get(dep)
            if pd and pd.status in ("cancelled", "rejected"):
                d.add_issue(Issue("missing_prerequisite",
                                  f"“{d.title}” waits for “{pd.title}”, which was cancelled. Is it still blocked?",
                                  d.evidence[:1], {"depends_on": dep}))

    def _jaccard(self, a: str | None, b: str | None) -> float:
        ta, tb = content_tokens(a), content_tokens(b)
        return len(ta & tb) / len(ta | tb) if ta and tb else 0.0

    def _infer_dependencies(self) -> None:
        """Deterministic dependency cues in a draft's own evidence. Only links items
        that already exist; the prerequisite must match the cue phrase better than
        the dependent itself does. Every inferred edge is labelled in the history."""
        live = [d for d in self.drafts.values() if d.status not in ("cancelled", "rejected")]
        for d in live:
            for sid in d.evidence:
                text = self.seg_by_id[sid].text
                for m in list(DEP_CUE.finditer(text)) + list(DEP_CUE_IN.finditer(text)):
                    phrase = m.group("x")
                    own = self._jaccard(phrase, d.title)
                    scored = sorted(((self._jaccard(phrase, p.title), p.key) for p in live if p.key != d.key),
                                    reverse=True)
                    if not scored or scored[0][0] < 0.5 or scored[0][0] <= own:
                        continue
                    if len(scored) > 1 and scored[1][0] == scored[0][0]:
                        continue  # two equally good prerequisites: do not guess
                    pre = scored[0][1]
                    if pre in d.depends_on or self._reaches(pre, d.key):
                        continue
                    d.depends_on.append(pre)
                    d.history.append({"type": "INFERRED_DEPENDENCY", "segment_ids": [sid],
                                      "summary": f"waits for {pre}: inferred from the words “{m.group(0).strip()}” "
                                                 "(rule-based, check it)"})

    def _state(self, d: Draft) -> str:
        if d.status in ("cancelled", "rejected", "completed", "tentative"):
            # Cancelling or completing APPROVED work is itself a proposed change that
            # the organiser approves (operation cancel/complete), not a final state.
            if not (d.existing_task_id and d.status in ("cancelled", "completed")):
                return d.status
        kinds = {i.kind for i in d.issues}
        if kinds & EXISTENCE_ISSUES:
            return "held"
        if kinds:
            return "needs_clarification"
        return "proposed"

    def _priority(self, d: Draft) -> dict:
        if d.priority_stated:
            return {"value": d.priority_stated, "basis": "stated"}
        if d.deadline.date:
            days = (date.fromisoformat(d.deadline.date) - self.ctx.meeting_date).days
            value = "high" if days <= 2 else "medium" if days <= 7 else "low"
            return {"value": value, "basis": f"derived: due {days} day(s) after the meeting"}
        return {"value": None, "basis": "unspecified"}

    def _operation(self, d: Draft, state: str) -> str:
        if d.existing_task_id:
            if state == "held":
                return "hold"
            if d.status == "cancelled":
                return "cancel"
            if d.status == "completed":
                return "complete"
            b = d.before or {}
            changed = (d.owner.name != b.get("owner") or d.deadline.date != b.get("due_date")
                       or sorted(d.depends_on) != sorted(b.get("depends_on") or [])
                       or d.blocked_reason is not None)
            return "update" if changed else "none"
        return {"proposed": "create", "needs_clarification": "create", "held": "hold",
                "tentative": "suggest", "cancelled": "drop", "rejected": "drop",
                "completed": "create_completed"}[state]

    def run(self, events: list[CommitmentEventOut]) -> ReconcileResult:
        valid: list[tuple[int, int, CommitmentEventOut]] = []
        for n, ev in enumerate(events):
            v = self._validate(n, ev)
            if v:
                valid.append((self.seg_index[v.segment_ids[0]], n, v))
        valid.sort(key=lambda x: (x[0], x[1]))  # chronological, stable on LLM order
        for _, _, ev in valid:
            self.apply(ev)

        self._infer_dependencies()
        for d in self.drafts.values():
            self._finalise_draft(d)

        items, clar = [], []
        unmapped_seen: dict[str, str] = {}
        for d in sorted(self.drafts.values(), key=lambda x: x.order):
            state = self._state(d)
            op = self._operation(d, state)
            if d.existing_task_id and op == "none" and not d.issues:
                continue
            clar_ids = []
            # Smallest useful question set: while an item's existence is in question,
            # its attribute questions are deferred (re-surfaced once that is answered).
            asked = [i for i in d.issues if i.kind in EXISTENCE_ISSUES] or d.issues
            for issue in d.issues:
                deferred = issue not in asked
                if issue.kind == "unmapped_speaker" and not deferred:  # one question per label
                    label = issue.data.get("speaker_label")
                    if label in unmapped_seen:
                        clar_ids.append(unmapped_seen[label])
                        for c in clar:
                            if c["id"] == unmapped_seen[label]:
                                c["item_keys"].append(d.key)
                        continue
                cid = f"q{len(clar) + 1}"
                if issue.kind == "unmapped_speaker" and not deferred:
                    unmapped_seen[issue.data.get("speaker_label")] = cid
                clar.append({"id": cid, "kind": issue.kind, "rank": ISSUE_RANK.get(issue.kind, 5),
                             "question": issue.detail, "item_keys": [d.key],
                             "segment_ids": issue.segment_ids, "data": issue.data,
                             "blocking": True, "deferred": deferred})
                clar_ids.append(cid)
            deps = []
            for dep in d.depends_on:
                if dep in self.drafts:
                    deps.append({"key": dep, "title": self.drafts[dep].title,
                                 "existing_task_id": self.drafts[dep].existing_task_id})
                elif dep in self.ledger:
                    deps.append({"key": dep, "title": self.ledger[dep].title, "existing_task_id": dep})
            items.append({
                "key": d.key, "title": d.title, "existing_task_id": d.existing_task_id,
                "operation": op, "state": state,
                "owner": d.owner.name, "owner_status": d.owner.status, "owner_note": d.owner.note,
                "owner_candidate": d.owner_candidate,
                "deadline": d.deadline.to_dict(), "priority": self._priority(d),
                "depends_on": deps, "blocked_reason": d.blocked_reason,
                "evidence_segment_ids": d.evidence, "history": d.history,
                "clarification_ids": clar_ids, "before": d.before,
            })
        clar.sort(key=lambda c: (c["rank"], c["id"]))
        # Recall safety net: lines no valid event cited, so the organiser can check them.
        cited = {s for _, _, ev in valid for s in ev.segment_ids}
        uncovered = [s.id for s in self.segments if s.id not in cited and len(s.text.split()) >= 4]
        result = ReconcileResult(items=items, clarifications=clar, decisions=self.decisions,
                                 open_questions=self.open_questions, rejected_events=self.rejected,
                                 warnings=self.warnings, uncovered_segment_ids=uncovered)
        result.fingerprint = hashlib.sha256(
            json.dumps([items, clar], sort_keys=True, default=str).encode()).hexdigest()[:16]
        return result


def reconcile(segments: list[Segment], events: list[CommitmentEventOut],
              ctx: ReconcileContext) -> ReconcileResult:
    return Reconciler(segments, ctx).run(events)
