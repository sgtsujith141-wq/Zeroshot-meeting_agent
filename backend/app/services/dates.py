"""Deterministic resolution of spoken deadline expressions.

The LLM only extracts the words that were spoken ("by Friday", "Friday olage",
"Thursday, October 22"). This module resolves them against the meeting's local
date. It never invents a clock time for a date-only deadline, and it flags
ambiguity instead of silently choosing.

kind:
  explicit  - an absolute calendar date was stated
  derived   - a relative expression resolved from the meeting date
  unknown   - an expression exists but cannot be resolved to one date
  none      - no deadline expression
"""

from __future__ import annotations

import calendar
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

WEEKDAYS: dict[str, int] = {
    # English
    "monday": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4,
    "saturday": 5, "sunday": 6,
    # Hindi (romanised)
    "somvar": 0, "somwar": 0, "mangalvar": 1, "mangalwar": 1, "budhvar": 2, "budhwar": 2,
    "guruvar": 3, "guruwar": 3, "brihaspativar": 3, "veervar": 3, "shukravar": 4,
    "shukrawar": 4, "shanivar": 5, "shaniwar": 5, "ravivar": 6, "raviwar": 6, "itvaar": 6,
    # Kannada (romanised)
    "somavara": 0, "mangalavara": 1, "budhavara": 2, "guruvara": 3, "shukravara": 4,
    "shanivara": 5, "bhanuvara": 6, "ravivara": 6,
}

MONTHS: dict[str, int] = {}
for _i in range(1, 13):
    MONTHS[calendar.month_name[_i].lower()] = _i
    MONTHS[calendar.month_abbr[_i].lower()] = _i
MONTHS["sept"] = 9

_WD = "|".join(sorted(WEEKDAYS, key=len, reverse=True))
_MON = "|".join(sorted(MONTHS, key=len, reverse=True))

RE_ISO = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
RE_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MON})\.?(?:,?\s+(20\d{{2}}))?\b", re.I)
RE_MONTH_DAY = re.compile(rf"\b({_MON})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(20\d{{2}}))?\b", re.I)
RE_NUMERIC = re.compile(r"\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?\b")
RE_WEEKDAY = re.compile(rf"\b(?:(this|next|coming)\s+)?({_WD})\b", re.I)
RE_IN_DAYS = re.compile(r"\bin\s+(\d{1,2}|a|one|two|three)\s+(day|days|week|weeks)\b", re.I)
RE_TIME = re.compile(r"\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b", re.I)

_WORD_NUM = {"a": 1, "one": 1, "two": 2, "three": 3}

TODAY_WORDS = re.compile(r"\b(today|tonight|eod|end of (?:the )?day|aaj|aj|ivattu|ivatthu|indu|indhu)\b", re.I)
TOMORROW_WORDS = re.compile(r"\b(tomorrow|tmrw|naale|nale)\b", re.I)
HINDI_KAL = re.compile(r"\bkal\b", re.I)
DAY_AFTER = re.compile(r"\b(day after tomorrow|parso|parson|naadidu|nadidu)\b", re.I)
END_OF_WEEK = re.compile(r"\b(end of (?:the |this )?week|eow|week end|weekend)\b", re.I)
THIS_WEEK = re.compile(r"\b(this week|within the week|ee vaara)\b", re.I)
NEXT_WEEK = re.compile(r"\b(next week|mundina vaara|agle hafte)\b", re.I)
END_OF_MONTH = re.compile(r"\b(end of (?:the |this )?month|eom|month end)\b", re.I)
CONDITIONAL = re.compile(
    r"\b(after|once|when|as soon as|aadmele|aadamele|aada mele|aadmel|aadhmele|ke baad|baad mein|hone ke baad)\b",
    re.I)
VAGUE = re.compile(r"\b(later|soon|asap|sometime|eventually|whenever|next sprint|at some point)\b", re.I)


@dataclass
class DeadlineInfo:
    raw: str | None = None
    date: str | None = None  # ISO YYYY-MM-DD, local meeting date; never a clock time
    kind: str = "none"  # explicit | derived | unknown | none
    ambiguous: bool = False
    candidates: list[str] = field(default_factory=list)
    time_text: str | None = None  # clock time exactly as spoken, if any; not converted
    note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _next_weekday(ref: date, weekday: int, *, allow_today: bool) -> date:
    delta = (weekday - ref.weekday()) % 7
    if delta == 0 and not allow_today:
        delta = 7
    return ref + timedelta(days=delta)


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _upcoming(meeting: date, month: int, day: int, year: int | None) -> date | None:
    if year:
        return _safe_date(year, month, day)
    d = _safe_date(meeting.year, month, day)
    if d and d < meeting - timedelta(days=1):
        d = _safe_date(meeting.year + 1, month, day)
    return d


def _explicit_dates(text: str, meeting: date) -> tuple[list[date], bool, str | None]:
    found: list[date] = []
    ambiguous = False
    note = None
    for m in RE_ISO.finditer(text):
        d = _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if d:
            found.append(d)
    for m in RE_DAY_MONTH.finditer(text):
        d = _upcoming(meeting, MONTHS[m.group(2).lower().rstrip(".")], int(m.group(1)),
                      int(m.group(3)) if m.group(3) else None)
        if d:
            found.append(d)
    for m in RE_MONTH_DAY.finditer(text):
        d = _upcoming(meeting, MONTHS[m.group(1).lower().rstrip(".")], int(m.group(2)),
                      int(m.group(3)) if m.group(3) else None)
        if d:
            found.append(d)
    if not found:
        for m in RE_NUMERIC.finditer(text):
            a, b = int(m.group(1)), int(m.group(2))
            yr = m.group(3)
            year = (2000 + int(yr) if yr and len(yr) == 2 else int(yr)) if yr else None
            # Indian convention is day/month; flag when month/day would also be valid.
            d = _upcoming(meeting, b, a, year)
            if d:
                found.append(d)
                if a <= 12 and b <= 12 and a != b:
                    ambiguous = True
                    alt = _upcoming(meeting, a, b, year)
                    note = f"'{m.group(0)}' read as day/month; month/day would be {alt}"
    return sorted(set(found)), ambiguous, note


def resolve_deadline(raw: str | None, meeting_date: date) -> DeadlineInfo:
    if raw is None or not raw.strip():
        return DeadlineInfo()
    text = raw.strip()
    info = DeadlineInfo(raw=text)
    t = RE_TIME.search(text)
    if t:
        info.time_text = t.group(1)

    explicit, num_ambiguous, num_note = _explicit_dates(text, meeting_date)
    weekday_matches = list(RE_WEEKDAY.finditer(text))

    if explicit:
        if len(explicit) > 1:
            info.kind = "unknown"
            info.ambiguous = True
            info.candidates = [d.isoformat() for d in explicit]
            info.note = "several different dates were stated"
            return info
        d = explicit[0]
        info.date, info.kind = d.isoformat(), "explicit"
        if num_ambiguous:
            info.ambiguous, info.note = True, num_note
        for wm in weekday_matches:
            if WEEKDAYS[wm.group(2).lower()] != d.weekday():
                info.ambiguous = True
                info.note = (f"stated weekday '{wm.group(2)}' does not match "
                             f"{d.isoformat()} ({calendar.day_name[d.weekday()]})")
        return info

    if DAY_AFTER.search(text):
        return _derived(info, meeting_date + timedelta(days=2))
    if TOMORROW_WORDS.search(text):
        return _derived(info, meeting_date + timedelta(days=1))
    if HINDI_KAL.search(text):
        info = _derived(info, meeting_date + timedelta(days=1))
        if not re.search(r"\bkal\s+tak\b", text, re.I):
            info.ambiguous = True
            info.note = "Hindi 'kal' can mean tomorrow or yesterday; read as tomorrow"
        return info
    if TODAY_WORDS.search(text):
        info = _derived(info, meeting_date)
        info.note = "same day as the meeting; no clock time was stated" if not info.time_text else None
        return info

    if weekday_matches:
        resolved: set[date] = set()
        for wm in weekday_matches:
            qualifier = (wm.group(1) or "").lower()
            wd = WEEKDAYS[wm.group(2).lower()]
            coming = _next_weekday(meeting_date, wd, allow_today=False)
            if qualifier == "next":
                following = coming + timedelta(days=7)
                # "next Friday" is genuinely ambiguous (this coming one or the week after).
                info.kind = "unknown"
                info.ambiguous = True
                info.candidates = [coming.isoformat(), following.isoformat()]
                info.note = f"'next {wm.group(2)}' could mean {coming} or {following}"
                return info
            if wd == meeting_date.weekday() and qualifier not in ("this", "coming"):
                info.kind = "unknown"
                info.ambiguous = True
                info.candidates = [meeting_date.isoformat(), coming.isoformat()]
                info.note = f"meeting is on a {wm.group(2)}; could be today or a week later"
                return info
            if wd == meeting_date.weekday():
                coming = meeting_date
            resolved.add(coming)
        if len(resolved) == 1:
            return _derived(info, resolved.pop())
        info.kind, info.ambiguous = "unknown", True
        info.candidates = sorted(d.isoformat() for d in resolved)
        info.note = "several weekdays were stated"
        return info

    m = RE_IN_DAYS.search(text)
    if m:
        n_raw = m.group(1).lower()
        n = int(n_raw) if n_raw.isdigit() else _WORD_NUM[n_raw]
        days = n * (7 if m.group(2).lower().startswith("week") else 1)
        return _derived(info, meeting_date + timedelta(days=days))

    if END_OF_WEEK.search(text):
        if meeting_date.weekday() >= 5:
            info.kind, info.ambiguous = "unknown", True
            nxt = _next_weekday(meeting_date, 4, allow_today=False)
            info.candidates = [nxt.isoformat()]
            info.note = "meeting held on a weekend; 'end of week' is unclear"
            return info
        info = _derived(info, _next_weekday(meeting_date, 4, allow_today=True))
        info.note = "end of week interpreted as Friday"
        return info
    if END_OF_MONTH.search(text):
        last = calendar.monthrange(meeting_date.year, meeting_date.month)[1]
        return _derived(info, meeting_date.replace(day=last))
    if NEXT_WEEK.search(text):
        monday = meeting_date + timedelta(days=7 - meeting_date.weekday())
        info.kind, info.ambiguous = "unknown", True
        info.candidates = [monday.isoformat(), (monday + timedelta(days=4)).isoformat()]
        info.note = "'next week' is a range, not a date"
        return info
    if THIS_WEEK.search(text):
        info.kind, info.ambiguous = "unknown", True
        info.candidates = [_next_weekday(meeting_date, 4, allow_today=True).isoformat()]
        info.note = "'this week' is a range, not a date"
        return info

    if CONDITIONAL.search(text):
        # "after the API is ready" / "API ready aadmele" states a precondition, not a date.
        info.kind = "none"
        info.note = "conditional timing (after/once …) — a precondition, not a calendar deadline"
        return info

    info.kind = "unknown"
    info.ambiguous = True
    info.note = ("vague timing; no concrete date" if VAGUE.search(text)
                 else "could not resolve this expression to a date")
    return info


def _derived(info: DeadlineInfo, d: date) -> DeadlineInfo:
    info.date = d.isoformat()
    info.kind = "derived"
    return info
