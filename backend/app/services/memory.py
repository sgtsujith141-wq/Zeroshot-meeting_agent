"""Grounded meeting memory over SQLite FTS5.

Indexed documents: transcript segments (what was said), approved decisions,
open questions, and the current state of approved tasks. Answers may only cite
retrieved passages; otherwise the answer is "not found in stored meetings".
"""

from __future__ import annotations

import unicodedata

from sqlalchemy import text
from sqlmodel import Session, select

from ..models import Decision, Meeting, OpenQuestion, Task, TranscriptSegment
from .llm import LLMError, LLMUnavailable, get_llm
from .llm_schemas import GroundedAnswerOut
from .prompts import MEMORY_SYSTEM

NOT_FOUND = "not found in stored meetings"
STOP = {"the", "a", "an", "is", "are", "was", "were", "what", "who", "when", "which", "did", "do", "does",
        "of", "to", "for", "in", "on", "and", "or", "about", "with", "we", "our", "it", "that", "this",
        "be", "by", "has", "have", "had", "how", "why", "there", "any", "from", "at", "as", "will"}


def _upsert(session: Session, doc_type: str, doc_id: str, meeting_id: int | None, body: str) -> None:
    session.execute(text("DELETE FROM memory_fts WHERE doc_id = :d"), {"d": doc_id})
    session.execute(text("INSERT INTO memory_fts(doc_type, doc_id, meeting_id, text) VALUES (:t, :d, :m, :x)"),
                 params={"t": doc_type, "d": doc_id, "m": meeting_id, "x": body})


def index_segment(session: Session, seg: TranscriptSegment) -> None:
    _upsert(session, "segment", f"seg:{seg.meeting_id}:{seg.seg_key}", seg.meeting_id, seg.text)


def index_task(session: Session, task: Task) -> None:
    body = (f"{task.code} {task.title}. Owner {task.owner or 'unassigned'}. Status {task.status}. "
            f"Due {task.due_date or 'no date'}.")
    _upsert(session, "task", f"task:{task.code}", task.origin_meeting_id, body)


def index_decision(session: Session, d: Decision) -> None:
    if d.approval_status != "approved":
        session.execute(text("DELETE FROM memory_fts WHERE doc_id = :d"), {"d": f"dec:{d.id}"})
        return
    _upsert(session, "decision", f"dec:{d.id}", d.meeting_id,
            f"Decision: {d.text}" + (f" Reason: {d.rationale}" if d.rationale else ""))


def index_question(session: Session, q: OpenQuestion) -> None:
    _upsert(session, "question", f"q:{q.id}", q.meeting_id, f"Open question: {q.text}")


def remove_meeting(session: Session, meeting_id: int) -> None:
    session.execute(text("DELETE FROM memory_fts WHERE meeting_id = :m"), {"m": meeting_id})


def _words(q: str) -> list[str]:
    # Letters, digits and combining marks (Indic vowel signs are category M; \w drops them).
    t = unicodedata.normalize("NFC", q.lower())
    return "".join(ch if unicodedata.category(ch)[0] in "LNM" else " " for ch in t).split()


def _fts_query(q: str) -> str | None:
    toks = [t for t in _words(q) if t not in STOP and len(t) > 1]
    if not toks:
        return None
    return " OR ".join(f'"{t}"*' for t in dict.fromkeys(toks))  # quoted: no FTS syntax injection


def search(session: Session, q: str, limit: int = 8) -> list[dict]:
    fq = _fts_query(q)
    if not fq:
        return []
    rows = session.execute(text(
        "SELECT doc_type, doc_id, meeting_id, text, bm25(memory_fts) AS score FROM memory_fts "
        "WHERE memory_fts MATCH :q ORDER BY score LIMIT :n"), {"q": fq, "n": limit}).all()
    out = []
    for i, r in enumerate(rows, start=1):
        meeting = session.get(Meeting, int(r.meeting_id)) if r.meeting_id is not None else None
        p = {"passage_id": f"P{i}", "doc_type": r.doc_type, "doc_id": r.doc_id, "text": r.text,
             "meeting_id": meeting.id if meeting else None,
             "meeting_title": meeting.title if meeting else None,
             "meeting_date": meeting.scheduled_at if meeting else None}
        if r.doc_type == "segment":
            _, mid, key = r.doc_id.split(":", 2)
            seg = session.exec(select(TranscriptSegment).where(TranscriptSegment.meeting_id == int(mid),
                                                               TranscriptSegment.seg_key == key)).first()
            if seg is None:
                continue  # stale index row; never cite something that no longer exists
            p.update({"seg_key": seg.seg_key, "speaker": seg.speaker_label,
                      "start_seconds": seg.start_seconds, "end_seconds": seg.end_seconds,
                      "timestamp_granularity": "segment (phrase/chunk), not word-level"})
        if r.doc_type == "task":
            t = session.exec(select(Task).where(Task.code == r.doc_id.split(":", 1)[1])).first()
            if t:
                p.update({"task_code": t.code, "task_status": t.status, "task_owner": t.owner,
                          "task_due": t.due_date})
        out.append(p)
    return out


def related_tasks(session: Session, passages: list[dict]) -> list[dict]:
    seg_refs = {(p["meeting_id"], p.get("seg_key")) for p in passages if p["doc_type"] == "segment"}
    codes = {p.get("task_code") for p in passages if p["doc_type"] == "task"}
    out = []
    for t in session.exec(select(Task)).all():
        if t.code in codes or any((e["meeting_id"], e["seg_key"]) in seg_refs for e in t.evidence):
            out.append({"code": t.code, "title": t.title, "owner": t.owner, "status": t.status,
                        "due_date": t.due_date, "revision": t.revision})
    return out


def answer(session: Session, question: str, use_llm: bool = True) -> dict:
    passages = search(session, question)
    current = related_tasks(session, passages)
    base = {"question": question, "passages": passages, "current_state": current}
    if not passages:
        return {**base, "answer": NOT_FOUND, "found": False, "mode": "retrieval", "citations": []}
    if use_llm:
        try:
            llm = get_llm()
            numbered = "\n".join(
                f"[{p['passage_id']}] ({p['doc_type']}; meeting “{p['meeting_title']}” {p['meeting_date']}"
                + (f"; {p['speaker']} at {p['start_seconds']:.0f}s" if p["doc_type"] == "segment" else "")
                + f") {p['text']}" for p in passages)
            user = f"<passages>\n{numbered}\n</passages>\n\nQuestion: {question}"
            out, call = llm.generate_json(MEMORY_SYSTEM, user, GroundedAnswerOut, purpose="memory_answer")
            valid = {p["passage_id"] for p in passages}
            cites = [c for c in out.citations if c in valid]
            if not out.found or not cites:
                return {**base, "answer": NOT_FOUND, "found": False, "mode": "llm_grounded",
                        "citations": [], "llm": {"provider": call.provider, "model": call.model},
                        "note": "model gave no valid citation" if out.found else None}
            return {**base, "answer": out.answer, "found": True, "mode": "llm_grounded",
                    "citations": [p for p in passages if p["passage_id"] in cites],
                    "llm": {"provider": call.provider, "model": call.model, "latency_ms": call.latency_ms}}
        except (LLMUnavailable, LLMError) as exc:
            base["llm_error"] = str(exc)[:200]
    top = passages[:3]
    return {**base, "answer": "Most relevant stored passages (extractive; no generated answer):",
            "found": True, "mode": "extractive", "citations": top}
