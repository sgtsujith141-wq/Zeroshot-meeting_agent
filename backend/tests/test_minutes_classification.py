"""Defect A (2026-10-23): minutes listed task assignments as decisions.
Sentences are the ones qwen3:8b actually produced in the live synthetic meetings."""

from app.services.processing import assignment_like

WORK = {  # segment -> [(owner, title)] of work-item events, as in live meetings 2 and 3
    "m2s3": [("Samiksha", "Run regression tests")], "m2s4": [("SELF", "Run regression tests")],
    "m2s6": [("Rahul", "Prepare the rollback runbook")], "m2s7": [("SELF", "Prepare the rollback runbook")],
    "m3s3": [("Rahul", "Prepare the rollback runbook")],
    "m3s4": [("Priya", "Follow up on finance sign-off")], "m3s5": [("SELF", "Follow up on finance sign-off")],
}


def test_assignments_and_status_reports_are_reclassified():
    assert assignment_like("Samiksha will own the regression tests.", ["m2s3", "m2s4"], WORK)
    assert assignment_like("Rahul will prepare the rollback runbook by Saturday.", ["m2s6", "m2s7"], WORK)
    assert assignment_like("Rollback runbook is ready for use.", ["m3s3"], WORK)
    assert assignment_like("Finance sign-off will be pursued by Priya by Wednesday.", ["m3s4", "m3s5"], WORK)


def test_genuine_decisions_are_kept():
    # meeting 1, s5 carried no work-item event
    assert assignment_like("Keep Stripe as the payment provider", ["m1s5"], WORK) is None
    # cited lines only partly covered by actions
    assert assignment_like("Samiksha will own the regression tests.", ["m2s3", "m1s5"], WORK) is None
    # a decision on action lines that names neither the owner nor the task
    assert assignment_like("We use weekly releases from now on.", ["m2s3"], WORK) is None
