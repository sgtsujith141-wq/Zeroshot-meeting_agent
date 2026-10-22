"""Single-organiser bearer-token auth for the local demo.

Limitations (documented in docs/privacy.md): one shared organiser secret, no
user accounts, no roles, no multi-tenancy. The server refuses all protected
requests when ORGANIZER_TOKEN is not configured.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import Header, HTTPException, status

from .config import get_settings


def require_organizer(authorization: str | None = Header(default=None)) -> str:
    s = get_settings()
    if not s.organizer_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "ORGANIZER_TOKEN is not configured on the server; refusing all protected requests")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "organiser token required",
                            headers={"WWW-Authenticate": "Bearer"})
    if not hmac.compare_digest(authorization[7:].encode(), s.organizer_token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid organiser token",
                            headers={"WWW-Authenticate": "Bearer"})
    return s.organizer_name


def sign_media(meeting_id: int, ttl: int = 3600) -> tuple[str, int]:
    """Short-lived signature so an <audio> element can stream without the bearer token."""
    exp = int(time.time()) + ttl
    msg = f"media:{meeting_id}:{exp}".encode()
    sig = hmac.new(get_settings().organizer_token.encode(), msg, hashlib.sha256).hexdigest()
    return sig, exp


def verify_media(meeting_id: int, sig: str, exp: int) -> bool:
    if not get_settings().organizer_token or exp < time.time():
        return False
    msg = f"media:{meeting_id}:{exp}".encode()
    good = hmac.new(get_settings().organizer_token.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)
