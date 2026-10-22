"""Approved meeting summary: prepared -> approved -> sent (only with a real channel)."""

from __future__ import annotations

import hashlib
import re
import smtplib
from email.message import EmailMessage

from sqlmodel import Session, select

from ..config import get_settings
from ..models import Approval, ChangeSet, Decision, Meeting, OpenQuestion, SummaryShare, Task
from .audit import record
from .clock import now_utc

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[A-Za-z]{2,}$")


def compose(session: Session, meeting: Meeting) -> str:
    applied = session.exec(select(ChangeSet).where(ChangeSet.meeting_id == meeting.id,
                                                   ChangeSet.state == "APPLIED")).all()
    codes = []
    for cs in applied:
        codes += list(cs.applied_result.get("created", {}).values()) + cs.applied_result.get("updated", [])
        codes += cs.applied_result.get("cancelled", [])
    tasks = [session.exec(select(Task).where(Task.code == c)).first() for c in dict.fromkeys(codes)]
    decisions = session.exec(select(Decision).where(Decision.meeting_id == meeting.id,
                                                    Decision.approval_status == "approved")).all()
    questions = session.exec(select(OpenQuestion).where(OpenQuestion.meeting_id == meeting.id)).all()
    m = meeting.minutes or {}
    lines = [f"Meeting summary — {meeting.title} ({meeting.scheduled_at}, {meeting.timezone})", ""]
    if m.get("summary"):
        lines += [m["summary"], ""]
    if decisions:
        lines.append("Decisions:")
        lines += [f"- {d.text}" + (f" (reason: {d.rationale})" if d.rationale else "") for d in decisions]
        lines.append("")
    if tasks:
        lines.append("Approved actions:")
        lines += [f"- {t.code} {t.title} — {t.owner or 'unassigned'}, due {t.due_date or 'no date'} [{t.status}]"
                  for t in tasks if t]
        lines.append("")
    if questions:
        lines.append("Open questions:")
        lines += [f"- {q.text}" for q in questions]
        lines.append("")
    if not applied:
        lines.append("(No change set for this meeting has been approved yet.)")
    return "\n".join(lines).strip() + "\n"


def prepare(session: Session, meeting: Meeting, actor: str) -> SummaryShare:
    share = SummaryShare(meeting_id=meeting.id, content=compose(session, meeting))
    session.add(share)
    session.flush()
    record(session, actor, "summary", share.id, "prepare")
    return share


def approve_and_send(session: Session, share: SummaryShare, actor: str, channel: str,
                     recipients: list[str], content_hash: str) -> SummaryShare:
    if share.state == "sent":
        return share  # idempotent: never send twice
    if hashlib.sha256(share.content.encode()).hexdigest() != content_hash:
        raise ValueError("summary content changed since it was reviewed")
    if channel not in ("copy", "email"):
        raise ValueError("channel must be 'copy' or 'email'")
    if channel == "email":
        bad = [r for r in recipients if not EMAIL_RE.match(r)]
        if not recipients or bad:
            raise ValueError(f"explicit, valid recipients are required (invalid: {bad})")
    snap = {"channel": channel, "recipients": recipients, "content_hash": content_hash}
    scope = f"summary:{share.id}"
    approval = session.exec(select(Approval).where(Approval.scope == scope, Approval.snapshot_hash == content_hash)).first()
    if approval is None:
        approval = Approval(actor=actor, scope=scope, snapshot_hash=content_hash, snapshot=snap)
        session.add(approval)
        session.flush()
    share.channel, share.recipients, share.approval_id, share.state = channel, recipients, approval.id, "approved"
    if channel == "email":
        s = get_settings()
        if not s.smtp_configured:
            share.error = "approved but NOT sent: no SMTP server is configured (copy/download instead)"
        else:
            try:
                msg = EmailMessage()
                msg["Subject"] = "Meeting summary"
                msg["From"], msg["To"] = s.smtp_from, ", ".join(recipients)
                msg.set_content(share.content)
                with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
                    smtp.starttls()
                    if s.smtp_username:
                        smtp.login(s.smtp_username, s.smtp_password)
                    smtp.send_message(msg)
                share.state, share.sent_at, share.error = "sent", now_utc(), None
            except Exception as exc:
                share.state, share.error = "failed", f"{type(exc).__name__}: {str(exc)[:200]}"
    session.add(share)
    record(session, actor, "summary", share.id, f"approve:{channel}", after={"state": share.state})
    return share
