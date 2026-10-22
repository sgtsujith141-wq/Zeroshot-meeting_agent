from datetime import date

import pytest

from app.services.dates import resolve_deadline
from app.services.identity import SpeakerDirectory, is_anonymous_label, resolve_owner
from app.services.llm_schemas import BaselineOut, InterpretationOut, inline_schema

MON = date(2026, 10, 19)


def test_inline_schema_keeps_properties_named_title():
    # Regression: stripping JSON-schema "title" metadata once deleted the `title` field.
    item = inline_schema(BaselineOut)["properties"]["action_items"]["items"]
    assert "title" in item["properties"] and "title" in item["required"]
    ev = inline_schema(InterpretationOut)["properties"]["events"]["items"]
    assert "title" in ev["properties"]
    assert "$ref" not in str(inline_schema(BaselineOut))


@pytest.mark.parametrize("raw,iso,kind,ambiguous", [
    ("by Friday", "2026-10-23", "derived", False),
    ("Friday olage", "2026-10-23", "derived", False),          # Kannada "before Friday"
    ("shukravara olage", "2026-10-23", "derived", False),
    ("Actually make that Thursday, October 22", "2026-10-22", "explicit", False),
    ("tonight", "2026-10-19", "derived", False),
    ("EOD", "2026-10-19", "derived", False),
    ("tomorrow", "2026-10-20", "derived", False),
    ("naale", "2026-10-20", "derived", False),                 # Kannada "tomorrow"
    ("kal tak", "2026-10-20", "derived", False),               # Hindi "by tomorrow"
    ("kal", "2026-10-20", "derived", True),                    # Hindi kal = tomorrow/yesterday
    ("next week", None, "unknown", True),
    ("next Friday", None, "unknown", True),
    ("Monday", None, "unknown", True),                         # meeting itself is on Monday
    ("by Thursday, October 23", "2026-10-23", "explicit", True),  # weekday/date conflict
    ("10/11", "2026-11-10", "explicit", True),                 # dd/mm vs mm/dd
    ("later", None, "unknown", True),
    ("2026-12-01", "2026-12-01", "explicit", False),
])
def test_deadline_resolution(raw, iso, kind, ambiguous):
    d = resolve_deadline(raw, MON)
    assert (d.date, d.kind, d.ambiguous) == (iso, kind, ambiguous)


def test_no_invented_clock_time():
    assert resolve_deadline("by Friday", MON).time_text is None
    assert resolve_deadline("Friday 5 pm", MON).time_text == "5 pm"
    assert resolve_deadline(None, MON).kind == "none"


def test_owner_resolution_rules():
    d = SpeakerDirectory({"SPEAKER_01": "Anita"})
    assert resolve_owner("SELF", "SPEAKER_01", d).name == "Anita"
    r = resolve_owner("SELF", "SPEAKER_02", d)
    assert r.name is None and r.status == "self_unmapped" and r.needs_identity
    assert resolve_owner("SPEAKER_02", "Lead", d).status == "unmapped_label"
    assert resolve_owner("SPEAKER_01", "Lead", d).name == "Anita"
    assert resolve_owner("we", "Lead", d).status == "group"
    assert resolve_owner("someone", "Lead", d).name is None
    assert resolve_owner(None, "Lead", d).status == "missing"
    assert resolve_owner("naanu", "Rahul", SpeakerDirectory()).name == "Rahul"
    assert is_anonymous_label("0") and is_anonymous_label("Speaker_00") and not is_anonymous_label("Rahul")
    strict = SpeakerDirectory({}, strict=True)
    assert resolve_owner("SELF", "Rahul", strict).name is None  # unconfirmed in strict app mode


@pytest.mark.parametrize("raw", ["after the API is ready", "aadmele naanu", "once QA signs off", "API ke baad"])
def test_conditional_timing_is_not_a_deadline(raw):
    # Post-hoc fix after eval run 20261022T165631Z: "aadmele" (Kannada: after) was read as a deadline.
    d = resolve_deadline(raw, MON)
    assert d.kind == "none" and d.date is None and not d.ambiguous
