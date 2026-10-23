"""Owners must come from the meeting. Found in Round 2 on holdout v3 with the live model:
the model wrote "R3ha" for Rhea, and made the chair the owner of "someone do X"."""

from test_reconcile import active, run, segs


def test_a_garbled_owner_name_is_not_assigned_and_the_question_suggests_the_real_name():
    s = segs(("Chair", "Rhea, please test the export endpoint next Monday."), ("Rhea", "Will do."))
    r = run(s, [{"type": "PROPOSE", "task_key": "export-test", "title": "Test the export endpoint", "owner": "R3ha",
                 "strength": "firm", "segment_ids": ["s1"]}])
    [item] = active(r)
    assert item["owner"] is None and item["state"] == "needs_clarification"
    q = next(c for c in r.clarifications if c["kind"] == "missing_owner")
    assert "R3ha" in q["question"] and "did it mean Rhea?" in q["question"]


def test_the_chair_asking_someone_to_do_it_does_not_become_the_owner():
    s = segs(("Chair", "Yaradru ondu dashboard draft maadi, Friday olage."))
    r = run(s, [{"type": "PROPOSE", "task_key": "dashboard", "title": "Dashboard draft", "owner": "Chair",
                 "deadline_text": "Friday olage", "strength": "firm", "segment_ids": ["s1"]}])
    [item] = active(r)
    assert item["owner"] is None and any(c["kind"] == "missing_owner" for c in r.clarifications)


def test_a_speaker_who_commits_in_the_first_person_stays_the_owner():
    for line in ("I'll update the release notes by Friday.", "Main release notes kal tak update kar dunga.",
                 "Naanu release notes naale maadtini."):
        s = segs(("Meera", line))
        r = run(s, [{"type": "PROPOSE", "task_key": "notes", "title": "Update the release notes", "owner": "Meera",
                     "strength": "firm", "segment_ids": ["s1"]}])
        [item] = active(r)
        assert item["owner"] == "Meera", line


def test_an_owner_named_in_the_meeting_or_on_the_board_is_kept():
    s = segs(("Lead", "Rahul, please finish the refund API by Thursday."))
    r = run(s, [{"type": "PROPOSE", "task_key": "refund", "title": "Finish the refund API", "owner": "Rahul",
                 "strength": "firm", "segment_ids": ["s1"]}])
    assert active(r)[0]["owner"] == "Rahul"
    s = segs(("Lead", "He is travelling, so the docs move to next week."))
    from app.services.reconcile import LedgerTask
    r = run(s, [{"type": "PROPOSE", "task_key": "docs", "title": "API docs", "owner": "Priya", "strength": "firm",
                 "segment_ids": ["s1"]}], ledger=[LedgerTask("TASK-9", "API docs", owner="Priya")])
    assert any(i["owner"] == "Priya" for i in r.items)  # a known task owner is not "invented"
