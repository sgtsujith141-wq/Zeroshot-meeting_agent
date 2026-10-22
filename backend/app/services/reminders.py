"""Durable reminders stored in SQLite, delivered by a polling worker thread.

In-app delivery creates a Notification row (a real deliverable). Email is only
attempted when SMTP is configured AND the reminder carries an approval; there is
no other outbound channel. The worker only runs while the backend process runs.
"""

from __future__ import annotations

import logging
import smtplib
import threading
from datetime import date, datetime, time, timedelta, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from ..config import get_settings
from ..models import Notification, Reminder, Task
from .audit import record
from .clock import now_utc

log = logging.getLogger("reminders")
REMINDER_LOCAL_TIME = time(9, 0)  # documented default: 09:00 local, the day before the due date


def plan_reminder(due_date: str | None, tz: str, now: datetime | None = None) -> datetime | None:
    """Aware-UTC time for the default reminder, or None if no future slot exists."""
    if not due_date:
        return None
    now = now or now_utc()
    zone = ZoneInfo(tz)
    due = date.fromisoformat(due_date)
    for day in (due - timedelta(days=1), due):
        local = datetime.combine(day, REMINDER_LOCAL_TIME, tzinfo=zone)
        utc = local.astimezone(timezone.utc)
        if utc > now:
            return utc
    return None


def schedule_for_task(session: Session, task: Task, approval_id: int | None) -> Reminder | None:
    for r in session.exec(select(Reminder).where(Reminder.task_id == task.id,
                                                 Reminder.delivery_state == "scheduled")).all():
        r.delivery_state = "cancelled"
        r.last_error = "superseded by an approved task change"
        session.add(r)
    if task.status in ("done", "cancelled"):
        return None
    at = plan_reminder(task.due_date, task.timezone)
    if at is None:
        return None
    r = Reminder(task_id=task.id, scheduled_at=at, channel="in_app", approval_id=approval_id,
                 message=f"Reminder: {task.code} “{task.title}” (owner {task.owner or 'unassigned'}) is due {task.due_date}.")
    session.add(r)
    return r


def _send_email(reminder: Reminder) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["Subject"] = "Task reminder"
    msg["From"] = s.smtp_from
    msg["To"] = ", ".join(reminder.recipients)
    msg.set_content(reminder.message)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if s.smtp_username:
            smtp.login(s.smtp_username, s.smtp_password)
        smtp.send_message(msg)


def deliver_due(session: Session, now: datetime | None = None) -> list[int]:
    """Deliver every scheduled reminder whose time has come. Idempotent per reminder."""
    now = now or now_utc()
    due = session.exec(select(Reminder).where(Reminder.delivery_state == "scheduled",
                                              Reminder.scheduled_at <= now)).all()
    delivered = []
    for r in due:
        task = session.get(Task, r.task_id)
        r.attempts += 1
        if task is None or task.status in ("done", "cancelled"):
            r.delivery_state, r.last_error = "cancelled", "task closed before reminder time"
        elif r.channel == "in_app":
            session.add(Notification(reminder_id=r.id, task_id=r.task_id, message=r.message, created_at=now))
            r.delivery_state, r.delivered_at = "delivered", now
            delivered.append(r.id)
        elif r.channel == "email":
            if not r.approval_id:
                r.delivery_state, r.last_error = "failed", "email reminder has no approval; not sent"
            elif not get_settings().smtp_configured:
                r.delivery_state, r.last_error = "failed", "SMTP not configured; not sent"
            else:
                try:
                    _send_email(r)
                    r.delivery_state, r.delivered_at = "delivered", now
                    delivered.append(r.id)
                except Exception as exc:  # keep error, never credentials
                    r.delivery_state, r.last_error = "failed", f"{type(exc).__name__}: {str(exc)[:200]}"
        session.add(r)
        record(session, "reminder-worker", "reminder", r.id, "deliver", result=r.delivery_state)
    session.commit()
    return delivered


class ReminderWorker:
    def __init__(self, engine, interval: int):
        self.engine, self.interval = engine, max(1, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_run: datetime | None = None
        self.last_delivered = 0

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="reminder-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                with Session(self.engine, expire_on_commit=False) as session:
                    self.last_delivered = len(deliver_due(session))
                self.last_run = now_utc()
            except Exception:
                log.exception("reminder worker iteration failed")
            self._stop.wait(self.interval)
