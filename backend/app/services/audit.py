from __future__ import annotations

import logging

from sqlmodel import Session

from ..models import AuditEvent
from .clock import now_utc

log = logging.getLogger("audit")


def record(session: Session, actor: str, object_type: str, object_id: str | int, action: str,
           before: dict | None = None, after: dict | None = None, result: str = "ok") -> None:
    session.add(AuditEvent(actor=actor, object_type=object_type, object_id=str(object_id), action=action,
                           before=before or {}, after=after or {}, result=result, created_at=now_utc()))
    # Operational log line carries identifiers only, never transcript text or secrets.
    log.info("audit actor=%s %s:%s %s result=%s", actor, object_type, object_id, action, result)
