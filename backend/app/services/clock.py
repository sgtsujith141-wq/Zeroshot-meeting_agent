"""Single source of 'now'. Tests may install a simulated clock; the API reports
when one is active so a clock-advanced run is never mistaken for a real one."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

_clock: Callable[[], datetime] | None = None


def now_utc() -> datetime:
    """Timezone-aware UTC datetime."""
    if _clock:
        return _clock()
    return datetime.now(timezone.utc)


def set_simulated_clock(fn: Callable[[], datetime] | None) -> None:
    global _clock
    _clock = fn


def is_simulated() -> bool:
    return _clock is not None
