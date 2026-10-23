"""Meeting report: a print-ready A4 document built only from stored records, rendered to PDF by
headless Chromium (system fonts, so Hindi, Kannada and other scripts are shaped and embedded).

Rules the report follows:
- every statement comes from a stored record (meeting, transcript, minutes, decisions, change
  set, tasks, task revisions); nothing is generated for the report;
- a proposal that is not approved is labelled PENDING APPROVAL and its tasks "Proposed";
- if the analysis did not finish, the report says so and contains the transcript only;
- speaker labels are shown as stored; a name appears only where the organiser or the
  transcript gave one.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import date, datetime, timezone
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from ..models import ChangeSet, Decision, LLMRun, Meeting, OpenQuestion, Participant, Task, TaskRevision, TranscriptSegment
from .tasks import OPEN_STATUSES, is_blocked, prerequisites, unfinished_prereqs

RENDER_TIMEOUT = 90
STATUS = {"todo": "To do", "in_progress": "In progress", "blocked": "Blocked", "done": "Done", "cancelled": "Cancelled"}
ACTIONABLE = ("create", "update", "cancel", "complete", "create_completed")


class ReportError(RuntimeError):
    pass


# ---- data -------------------------------------------------------------------------------------

def _clock(sec: float | None) -> str:
    if sec is None:
        return ""
    s = int(sec)
    h, m, r = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{r:02d}" if h else f"{m}:{r:02d}"


def _day(iso: str | None) -> str:
    if not iso:
        return "No date"
    d = date.fromisoformat(iso[:10])
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b %Y')}"


def gather(session: Session, meeting_id: int) -> dict:
    m = session.get(Meeting, meeting_id)
    if m is None:
        raise ReportError("meeting not found")
    segs = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
                        .order_by(TranscriptSegment.order_index)).all()
    if not segs:
        raise ReportError("this meeting has no transcript yet, so there is nothing to report")
    people = {p.speaker_label: p for p in session.exec(select(Participant).where(Participant.meeting_id == m.id))}
    by_key = {s.seg_key: s for s in segs}

    def who(label: str) -> str:
        p = people.get(label)
        return p.display_name if p and p.display_name and p.display_name != label else label

    def ref(key: str) -> str:
        s = by_key.get(key)
        return f"{who(s.speaker_label)} {_clock(s.start_seconds)} ({key})" if s else f"({key}, not in transcript)"

    cs = session.exec(select(ChangeSet).where(ChangeSet.meeting_id == m.id).order_by(ChangeSet.id.desc())).first()
    minutes = m.minutes or {}
    analysed = bool(minutes.get("summary")) or cs is not None
    state = cs.state if cs else None
    approval = {"APPLIED": "Approved", "NEEDS_CLARIFICATION": "Pending approval: questions open",
                "READY_FOR_REVIEW": "Pending approval", "REJECTED": "Rejected", "FAILED": "Approval failed",
                "APPROVED": "Being applied", "DRAFT": "Draft"}.get(state or "", "Not analysed")
    approved = state == "APPLIED"
    proposal = (cs.proposal if cs else None) or {}
    items = proposal.get("items", [])
    applied = (cs.applied_result if cs else None) or {}

    actions, changes, mentions = [], [], []
    if approved:
        for it in items:
            code = (applied.get("created") or {}).get(it["key"]) or (
                it.get("existing_task_id") if it.get("existing_task_id") in
                (applied.get("updated") or []) + (applied.get("completed") or []) + (applied.get("cancelled") or []) else None)
            t = session.exec(select(Task).where(Task.code == code)).first() if code else None
            if t is None:
                if it.get("state") in ("tentative", "cancelled", "rejected", "completed", "no_change"):
                    mentions.append({"title": it["title"], "why": it.get("state", "")})
                continue
            actions.append({"code": t.code, "title": t.title, "owner": t.owner or "Unassigned", "due": _day(t.due_date),
                            "priority": (t.priority or "—").capitalize(), "status": f"{STATUS.get(t.status, t.status)} (approved)",
                            "deps": ", ".join(f"{p.code} {p.title}" for p in prerequisites(session, t)) or "—",
                            "refs": [ref(k) for k in it.get("evidence_segment_ids", [])[:2]]})
        for rev in session.exec(select(TaskRevision).where(TaskRevision.change_set_id == cs.id)).all():
            if rev.revision == 1:
                continue  # a task created by this meeting is in the action register
            prev = session.exec(select(TaskRevision).where(TaskRevision.task_id == rev.task_id,
                                                           TaskRevision.revision == rev.revision - 1)).first()
            t = session.get(Task, rev.task_id)
            if not prev or not t:
                continue
            for field, label, fmt in (("owner", "Owner", lambda v: v or "Unassigned"), ("due_date", "Due date", _day),
                                      ("priority", "Priority", lambda v: (v or "Not set").capitalize()),
                                      ("status", "Status", lambda v: STATUS.get(v or "", v or "")), ("title", "Title", str)):
                a, b = prev.snapshot.get(field), rev.snapshot.get(field)
                if a != b:
                    changes.append({"code": t.code, "task": t.title, "field": label, "before": fmt(a), "after": fmt(b), "approved": "Yes"})
    else:
        board = {t.code: t for t in session.exec(select(Task)).all()}
        for it in items:
            st, op = it.get("state"), it.get("operation")
            if st in ("tentative", "cancelled", "rejected", "completed", "no_change") or it.get("excluded"):
                mentions.append({"title": it["title"], "why": "excluded by the organiser" if it.get("excluded") else st})
                continue
            if not (op in ACTIONABLE or st in ("needs_clarification", "held")):
                continue
            existing = board.get(it.get("existing_task_id") or "")
            label = "Needs an answer" if st in ("needs_clarification", "held") else "Proposed, not approved"
            actions.append({"code": it.get("existing_task_id") or "New", "title": existing.title if existing else it["title"],
                            "owner": it.get("owner") or "Unassigned",
                            "due": _day((it.get("deadline") or {}).get("date")) if (it.get("deadline") or {}).get("date")
                            else (f"“{it['deadline']['raw']}” (unresolved)" if (it.get("deadline") or {}).get("raw") else "No date"),
                            "priority": ((it.get("priority") or {}).get("value") or "—").capitalize(), "status": label,
                            "deps": ", ".join(d.get("existing_task_id") or d["title"] for d in it.get("depends_on", [])) or "—",
                            "refs": [ref(k) for k in it.get("evidence_segment_ids", [])[:2]]})
            if existing:
                proposed = {"Owner": (existing.owner or "Unassigned", it.get("owner") or "Unassigned"),
                            "Due date": (_day(existing.due_date), _day((it.get("deadline") or {}).get("date")))}
                if op == "cancel":
                    proposed = {"Status": (STATUS.get(existing.status, existing.status), "Cancelled")}
                elif op == "complete":
                    proposed = {"Status": (STATUS.get(existing.status, existing.status), "Done")}
                elif (it.get("priority") or {}).get("value") and it["priority"]["value"] != existing.priority:
                    proposed["Priority"] = ((existing.priority or "Not set").capitalize(), it["priority"]["value"].capitalize())
                for field, (a, b) in proposed.items():
                    if a != b and not (field == "Due date" and b == "No date"):
                        changes.append({"code": existing.code, "task": existing.title, "field": field, "before": a, "after": b,
                                        "approved": "No: pending approval"})

    clarifications = []
    if state in ("NEEDS_CLARIFICATION", "READY_FOR_REVIEW", "DRAFT"):
        excluded = {i["key"] for i in items if i.get("excluded")}
        clarifications = [{"question": c["question"], "refs": [ref(k) for k in c.get("segment_ids", [])[:2]]}
                          for c in sorted(proposal.get("clarifications", []), key=lambda c: c.get("rank", 0))
                          if not c.get("answer") and not c.get("deferred")
                          and not (c.get("item_keys") and all(k in excluded for k in c["item_keys"]))]
    open_qs = [{"question": q.text, "refs": [ref(k) for k in q.evidence_segment_ids[:2]]}
               for q in session.exec(select(OpenQuestion).where(OpenQuestion.meeting_id == m.id, OpenQuestion.status == "open"))]
    decisions = [{"text": d.text, "rationale": d.rationale, "status": {"approved": "Approved", "rejected": "Not recorded"}.get(d.approval_status, "Proposed"),
                  "refs": [ref(k) for k in d.evidence_segment_ids[:3]]}
                 for d in session.exec(select(Decision).where(Decision.meeting_id == m.id))]

    related = [t for t in session.exec(select(Task)).all()
               if t.status in OPEN_STATUSES and (t.origin_meeting_id == m.id or t.last_meeting_id == m.id
                                                 or any(e.get("meeting_id") == m.id for e in (t.evidence or [])))]
    pending = [{"code": t.code, "title": t.title, "owner": t.owner or "Unassigned", "due": _day(t.due_date)} for t in related]
    blocked = [{"code": t.code, "title": t.title,
                "waits": ", ".join(f"{p.code} {p.title}" for p in unfinished_prereqs(session, t)) or t.blocked_reason or "reason not recorded"}
               for t in related if is_blocked(session, t)]

    t_log = next((entry for entry in reversed(m.processing_log or []) if entry.get("step") == "transcribe" and entry.get("status") == "ok"), None)
    diarized = None if m.source_type not in ("audio", "video") else (
        False if m.stt_provider == "whisper-local" else ("diarized=True" in (t_log or {}).get("detail", "") if t_log else None))
    run = session.exec(select(LLMRun).where(LLMRun.meeting_id == m.id, LLMRun.error.is_(None))
                       .order_by(LLMRun.id.desc())).first()
    tz = ZoneInfo(m.timezone or "UTC")
    now = datetime.now(timezone.utc).astimezone(tz)
    return {
        "id": m.id, "title": m.title, "date": _meeting_when(m.scheduled_at), "timezone": m.timezone,
        "generated": f"{now.day} {now.strftime('%b %Y, %H:%M')} ({m.timezone})",
        "synthetic": bool(re.search("synthetic", f"{m.title} {m.file_name or ''}", re.I)),
        "source": {"audio": "Audio recording", "video": "Video recording", "transcript": "Uploaded transcript"}.get(m.source_type or "", "Unknown"),
        "file": m.file_name, "duration": _clock(m.duration_seconds) if m.duration_seconds else None,
        "stt": f"{m.stt_provider} ({m.stt_model})" if m.stt_provider else None, "diarized": diarized,
        "llm": f"{run.provider}/{run.model}" if run else None,
        "processing": {"ready_for_review": "Complete", "transcribed": "Transcribed; analysis not run",
                       "failed": f"Analysis failed: {m.processing_error or 'no detail'}"}.get(m.processing_status, m.processing_status),
        "analysed": analysed, "approval": approval, "approved": approved, "pending": bool(cs) and not approved and state != "REJECTED",
        "summary": minutes.get("summary"), "discussion": [{"topic": t.get("topic", ""), "summary": t.get("summary", ""),
                                                           "refs": [ref(k) for k in t.get("segment_ids", [])[:3]]} for t in minutes.get("discussion", [])],
        "decisions": decisions, "actions": actions, "changes": changes, "mentions": mentions,
        "clarifications": clarifications, "open_questions": open_qs, "follow_pending": pending, "follow_blocked": blocked,
        "speakers": [{"label": label, "name": p.display_name, "confirmed": p.confirmed_identity} for label, p in people.items()],
        "transcript": [{"t": _clock(s.start_seconds), "who": who(s.speaker_label), "label": s.speaker_label, "key": s.seg_key,
                        "text": s.text, "corrected": s.revision > 1} for s in segs],
    }


def _meeting_when(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
    except ValueError:
        return iso
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B %Y, %H:%M')}"


# ---- document -----------------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 22mm 17mm 20mm 17mm;
  @top-left { content: "Meeting Actions"; font: 600 8pt var(--sans); color: #172D30; letter-spacing: .02em; }
  @top-right { content: "%(title)s"; font: 8pt var(--sans); color: #637178; }
  @bottom-left { content: "%(status)s"; font: 8pt var(--sans); color: #637178; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt var(--sans); color: #637178; } }
@page :first { @top-left { content: none; } @top-right { content: none; } }
:root { --sans: "Avenir Next", "Helvetica Neue", "Segoe UI", "Noto Sans", Arial, "Kohinoor Devanagari", "Noto Sans Devanagari", "Noto Sans Kannada", "Kannada Sangam MN", sans-serif;
  --serif: "Iowan Old Style", "Charter", "Georgia", "Noto Serif", "Noto Serif Devanagari", "Noto Serif Kannada", serif; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: var(--sans); font-size: 9.6pt; line-height: 1.5; color: #19262A; }
header.cover { border-top: 5pt solid #172D30; padding-top: 14pt; margin-bottom: 18pt; }
.brand { display: flex; align-items: center; gap: 7pt; font: 600 9pt var(--sans); color: #172D30; letter-spacing: .02em; }
.brand .mark { width: 15pt; height: 15pt; border-radius: 3pt; background: #172D30; position: relative; }
.brand .mark::after { content: ""; position: absolute; left: 4pt; right: 4pt; top: 6.5pt; height: 2pt; background: #C8583D; }
.kind { margin-top: 18pt; font: 600 8.5pt var(--sans); color: #A9422B; letter-spacing: .08em; }
h1 { font-family: var(--serif); font-weight: 600; font-size: 25pt; line-height: 1.15; margin: 4pt 0 10pt; letter-spacing: -.01em; }
.tags { display: flex; gap: 6pt; flex-wrap: wrap; margin-bottom: 12pt; }
.tag { font: 600 7.5pt var(--sans); letter-spacing: .07em; padding: 2.5pt 6pt; border-radius: 2pt; border: .75pt solid currentColor; }
.tag.pending { color: #A9422B; background: #F3E6DD; border-color: #E2C2B0; }
.tag.approved { color: #1F6450; background: #E3F0EA; border-color: #BFD9CC; }
.tag.plain { color: #19262A; }
.tag.synthetic { color: #637178; }
dl.meta { display: grid; grid-template-columns: 30mm 1fr 30mm 1fr; gap: 3pt 10pt; margin: 0; font-size: 8.8pt; }
dl.meta dt { color: #637178; } dl.meta dd { margin: 0; }
.notice { margin-top: 12pt; padding: 7pt 10pt; border-left: 2.5pt solid #C8583D; background: #FAF6F1; font-size: 8.8pt; }
h2 { font-family: var(--serif); font-weight: 600; font-size: 14pt; margin: 20pt 0 6pt; padding-bottom: 4pt; border-bottom: .75pt solid #E3E2DC; break-after: avoid; }
h2 .n { color: #C8583D; margin-right: 6pt; font-family: var(--sans); font-size: 10pt; }
h3 { font-size: 10pt; margin: 10pt 0 2pt; break-after: avoid; }
p { margin: 0 0 6pt; } .lead { font-size: 10.6pt; line-height: 1.55; max-width: 165mm; }
.ref { color: #637178; font-size: 8pt; white-space: nowrap; }
.muted { color: #637178; }
.item { break-inside: avoid; margin-bottom: 8pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.6pt; }
thead { display: table-header-group; }
th { text-align: left; font-weight: 600; color: #637178; font-size: 7.8pt; letter-spacing: .03em; border-bottom: .75pt solid #19262A; padding: 4pt 5pt 4pt 0; }
td { border-bottom: .5pt solid #E3E2DC; padding: 5pt 5pt 5pt 0; vertical-align: top; }
tr { break-inside: avoid; }
td.task { font-weight: 600; } td.code { color: #637178; white-space: nowrap; }
.st-pending { color: #A9422B; } .st-approved { color: #1F6450; }
ul.plain { margin: 0; padding-left: 12pt; } ul.plain li { margin-bottom: 4pt; }
.appendix { break-before: page; }
.transcript { display: grid; grid-template-columns: 13mm 32mm 1fr; font-size: 8.8pt; }
.transcript div { padding: 3pt 6pt 3pt 0; border-bottom: .5pt solid #EEEDE8; break-inside: avoid; }
.transcript .t { color: #637178; font-variant-numeric: tabular-nums; }
.transcript .w { font-weight: 600; }
.transcript .x { font-family: var(--serif); font-size: 9.4pt; }
footer.meta-notes { margin-top: 18pt; font-size: 8pt; color: #637178; break-inside: avoid; }
"""


def _e(v: object) -> str:
    return escape("" if v is None else str(v))


def _css_str(v: str) -> str:
    """Text for a CSS string literal (running header and footer)."""
    # "<" as a CSS escape, so a title can never close the <style> element.
    return re.sub(r"[\x00-\x1f]", " ", v.replace("\\", "\\\\").replace('"', '\\"').replace("<", "\\3C "))[:110]


def _refs(refs: list[str]) -> str:
    return " ".join(f'<span class="ref">{_e(r)}</span>' for r in refs)


def to_html(d: dict) -> str:
    status_line = f"{d['title']}, {d['approval']}" + (", SYNTHETIC" if d["synthetic"] else "")
    tags = []
    if not d["analysed"]:
        tags.append('<span class="tag plain">TRANSCRIPT ONLY</span>')
    elif d["approved"]:
        tags.append('<span class="tag approved">APPROVED</span>')
    elif d["pending"]:
        tags.append('<span class="tag pending">DRAFT: PENDING APPROVAL</span>')
    else:
        tags.append(f'<span class="tag plain">{_e(d["approval"].upper())}</span>')
    if d["synthetic"]:
        tags.append('<span class="tag synthetic">SYNTHETIC TEST DATA</span>')
    meta = [("Date", d["date"]), ("Time zone", d["timezone"]), ("Source", d["source"] + (f", {d['duration']}" if d["duration"] else "")),
            ("Transcribed by", d["stt"] or ("Not applicable (uploaded transcript)" if d["source"] == "Uploaded transcript" else "Unknown")),
            ("Analysed by", d["llm"] or "Not analysed"), ("Processing", d["processing"]), ("Approval", d["approval"]), ("Report generated", d["generated"])]
    css = CSS.replace('"%(title)s"', f'"{_css_str(d["title"])}"').replace('"%(status)s"', f'"{_css_str(status_line)}"')
    out = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{_e(d['title'])}: meeting report</title><style>{css}</style></head><body>",
           "<header class='cover'><div class='brand'><span class='mark'></span>Meeting Actions</div>",
           "<div class='kind'>MEETING REPORT</div>", f"<h1>{_e(d['title'])}</h1>",
           f"<div class='tags'>{''.join(tags)}</div><dl class='meta'>",
           "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in meta), "</dl>"]
    if d["pending"]:
        out.append("<div class='notice'><strong>Not approved.</strong> The actions and changes below are proposals from this meeting. "
                   "Nothing in this report has been applied to the task board until the organiser approves it.</div>")
    if not d["analysed"]:
        why = "has not been run yet" if d["processing"].startswith("Transcribed") else "did not complete"
        out.append(f"<div class='notice'><strong>Transcription only.</strong> The AI analysis of this meeting {why}, so this "
                   "report has no summary, decisions or actions. It contains the stored transcript.</div>")
    if d["diarized"] is False:
        out.append("<div class='notice'>Speaker separation was not available with the transcription provider used for this recording; "
                   "lines carry one speaker label unless the organiser named the speaker.</div>")
    out.append("</header>")

    n = 0

    def section(title: str) -> str:
        nonlocal n
        n += 1
        return f"<h2><span class='n'>{n}</span>{_e(title)}</h2>"

    if d["analysed"]:
        out.append(section("Executive summary"))
        out.append(f"<p class='lead'>{_e(d['summary'])}</p>" if d["summary"] else "<p class='muted'>No summary was stored for this meeting.</p>")
        if d["discussion"]:
            out.append(section("Key discussion points"))
            out += [f"<div class='item'><h3>{_e(t['topic'])}</h3><p>{_e(t['summary'])} {_refs(t['refs'])}</p></div>" for t in d["discussion"]]
        out.append(section("Decisions"))
        if d["decisions"]:
            for x in d["decisions"]:
                why = f"Rationale: {_e(x['rationale'])}" if x["rationale"] else "<span class='muted'>No rationale was stated.</span>"
                out.append(f"<div class='item'><h3>{_e(x['text'])}</h3><p>{why} <span class='muted'>· {_e(x['status'])}</span> {_refs(x['refs'])}</p></div>")
        else:
            out.append("<p class='muted'>No decisions were recorded.</p>")
        out.append(section("Action register"))
        if d["actions"]:
            out.append("<table><thead><tr><th>Task</th><th>Owner</th><th>Due date</th><th>Priority</th><th>Status</th><th>Depends on</th><th>Source</th></tr></thead><tbody>")
            for a in d["actions"]:
                cls = "st-approved" if a["status"].endswith("(approved)") else "st-pending"
                out.append(f"<tr><td class='task'><span class='code'>{_e(a['code'])}</span><br>{_e(a['title'])}</td><td>{_e(a['owner'])}</td><td>{_e(a['due'])}</td>"
                           f"<td>{_e(a['priority'])}</td><td class='{cls}'>{_e(a['status'])}</td><td>{_e(a['deps'])}</td><td>{_refs(a['refs'])}</td></tr>")
            out.append("</tbody></table>")
        else:
            out.append("<p class='muted'>No action items.</p>")
        if d["mentions"]:
            out.append("<p class='muted' style='margin-top:6pt'>Mentioned but not tasks: " + "; ".join(
                f"{_e(x['title'])} ({_e(str(x['why']).replace('_', ' '))})" for x in d["mentions"]) + ".</p>")
        if d["changes"]:
            out.append(section("Changes to previous commitments"))
            out.append("<table><thead><tr><th>Task</th><th>Field</th><th>Before</th><th>After</th><th>Approved</th></tr></thead><tbody>")
            out += [f"<tr><td class='task'><span class='code'>{_e(c['code'])}</span><br>{_e(c['task'])}</td><td>{_e(c['field'])}</td>"
                    f"<td>{_e(c['before'])}</td><td>{_e(c['after'])}</td><td class='{'st-approved' if c['approved'] == 'Yes' else 'st-pending'}'>{_e(c['approved'])}</td></tr>"
                    for c in d["changes"]]
            out.append("</tbody></table>")
        out.append(section("Outstanding questions"))
        qs = [("Needs an answer before approval", q) for q in d["clarifications"]] + [("Raised in the meeting", q) for q in d["open_questions"]]
        if qs:
            out.append("<ul class='plain'>" + "".join(f"<li><strong>{_e(k)}:</strong> {_e(q['question'])} {_refs(q['refs'])}</li>" for k, q in qs) + "</ul>")
        else:
            out.append("<p class='muted'>None.</p>")
        out.append(section("Follow-up overview"))
        if d["follow_pending"]:
            out.append("<h3>Open work from this meeting</h3><ul class='plain'>" + "".join(
                f"<li><span class='code muted'>{_e(t['code'])}</span> {_e(t['title'])}, {_e(t['owner'])}, due {_e(t['due'])}</li>" for t in d["follow_pending"]) + "</ul>")
        if d["follow_blocked"]:
            out.append("<h3>Blocked</h3><ul class='plain'>" + "".join(
                f"<li><span class='code muted'>{_e(t['code'])}</span> {_e(t['title'])}: waiting for {_e(t['waits'])}</li>" for t in d["follow_blocked"]) + "</ul>")
        if not d["follow_pending"] and not d["follow_blocked"]:
            out.append("<p class='muted'>" + ("No approved task from this meeting is open." if d["approved"] else
                                              "Follow-up starts once the proposed tasks are approved.") + "</p>")

    # The appendix starts on a new page after the analysis; a transcript-only report starts it at once.
    out.append(f"<section class='{'appendix' if d['analysed'] else ''}'>{section('Transcript appendix' if d['analysed'] else 'Transcript')}")
    if d["speakers"]:
        def speaker(s: dict) -> str:
            if not s["name"]:
                return f"{_e(s['label'])} (not identified)"
            who = _e(s["name"]) if s["name"] == s["label"] else f"{_e(s['label'])} = {_e(s['name'])}"
            return who + (" (confirmed by the organiser)" if s["confirmed"] else " (named in the transcript, not confirmed)")
        out.append("<p class='muted'>Speakers: " + "; ".join(speaker(s) for s in d["speakers"]) + "</p>")
    out.append("<div class='transcript'>")
    for s in d["transcript"]:
        label = _e(s["who"]) if s["who"] == s["label"] else f"{_e(s['who'])}<br><span class='muted' style='font-weight:400'>{_e(s['label'])}</span>"
        out.append(f"<div class='t'>{_e(s['t'])}<br><span class='muted'>{_e(s['key'])}</span></div><div class='w'>{label}</div>"
                   f"<div class='x'>{_e(s['text'])}{' <span class=ref>(corrected)</span>' if s['corrected'] else ''}</div>")
    out.append("</div></section>")
    out.append("<footer class='meta-notes'><strong>About this report.</strong> Generated from the records stored by Meeting Actions; nothing was written "
               "for the report itself. References such as “Asha 0:08 (s3)” point to transcript segment s3, spoken by that speaker at that time. "
               "Timestamps are per segment, not per word. Speaker labels are not verified identities unless marked confirmed. "
               + ("Actions marked approved are on the task board as shown. " if d["approved"] else
                  "Proposed actions and changes are not on the task board until the organiser approves them. ")
               + ("This meeting is synthetic test data, not a real meeting. " if d["synthetic"] else "")
               + "</footer></body></html>")
    return "".join(out)


# ---- PDF ------------------------------------------------------------------------------------------

def find_chrome() -> str | None:
    """A Chromium that can print to PDF: PDF_CHROME, a Playwright browser, or an installed Chrome/Edge."""
    if os.getenv("PDF_CHROME") and Path(os.environ["PDF_CHROME"]).exists():
        return os.environ["PDF_CHROME"]
    home = Path.home()
    patterns = [f"{home}/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell",
                f"{home}/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell",
                f"{home}/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/*",
                f"{home}/.cache/ms-playwright/chromium-*/chrome-linux*/chrome"]
    for pat in patterns:
        found = sorted(glob.glob(pat), key=lambda p: [int(x) for x in re.findall(r"-(\d+)/", p)] or [0], reverse=True)
        if found:
            return found[0]
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"):
        if Path(p).exists():
            return p
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"):
        if shutil.which(name):
            return shutil.which(name)
    return None


def render_pdf(html: str) -> tuple[bytes, float]:
    chrome = find_chrome()
    if not chrome:
        raise ReportError("no Chromium is available to render the PDF; run `npx playwright install chromium-headless-shell` "
                          "in frontend/ or set PDF_CHROME to a Chrome or Chromium executable")
    with tempfile.TemporaryDirectory(prefix="ps53-report-") as tmp:
        src, dst = Path(tmp) / "report.html", Path(tmp) / "report.pdf"
        src.write_text(html, encoding="utf-8")
        args = [chrome, "--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", f"--user-data-dir={tmp}/profile",
                f"--print-to-pdf={dst}", src.as_uri()]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            args.insert(1, "--no-sandbox")
        started = time.perf_counter()
        try:
            out = subprocess.run(args, capture_output=True, text=True, timeout=RENDER_TIMEOUT, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ReportError("PDF rendering timed out") from exc
        ms = (time.perf_counter() - started) * 1000
        if not dst.exists() or dst.stat().st_size == 0:
            raise ReportError(f"PDF rendering failed: {(out.stderr or '').strip()[-300:] or 'no output'}")
        return dst.read_bytes(), ms
