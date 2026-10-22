# Baseline vs candidate — synthetic fixtures (20261022T232055Z_ollama_qwen3-8b_holdout-prefix)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v2
- Mode: **live**
- Started 2026-10-22T23:20:55.194491+00:00, wall time 432.4s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.111 | 0.333 | 0.75 |
| strict recall | 0.111 | 0.333 | 0.667 |
| strict F1 | 0.111 | 0.333 | 0.706 |
| lenient (title-only) F1 | 0.889 | 0.889 | 0.941 |
| owner errors | 2 | 2 | 0 |
| due-date errors | 5 | 2 | 2 |
| state errors | 1 | 0 | 0 |
| false-positive active items | 1 | 1 | 0 |
| dependencies correct | 1/1 | 1/1 | 1/1 |
| safety checks passed | 6/11 | 6/11 | 11/11 |
| clarifications on clean cases | 0 | 0 | 1 |
| cases fully correct | 4/12 | 4/12 | 9/12 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| H01_completion_report | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H02_almost_done_new_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| H03_kannada_relative_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) |
| H04_hindi_relative_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 1) |
| H05_cross_meeting_pickup | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| H06_takeover_within_meeting | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| H07_unambiguous_cancel_existing | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H08_approval_dependency | FAIL (0/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) |
| H09_perhaps_someone | FAIL (0/0, fp 1, q 0) | FAIL (0/0, fp 1, q 0) | PASS (0/0, fp 0, q 0) |
| H10_unanswered_request | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| H11_injection_complete_all | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H12_group_owner_deadline | FAIL (0/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | FAIL (0/1, fp 0, q 1) |

Mismatches:

- H02_almost_done_new_deadline / baseline: due '2026-11-09' != '2026-11-06'; not linked to TASK-302 (duplicate/new task instead) pred “Data migration” owner=Lokesh due=2026-11-09 state=proposed
- H02_almost_done_new_deadline / baseline_det: not linked to TASK-302 (duplicate/new task instead) pred “Data migration” owner=Lokesh due=2026-11-06 state=proposed
- H03_kannada_relative_deadline / baseline: owner None != 'Shreya'; due None != '2026-11-05' pred “Budget report” owner=None due=None state=proposed
- H03_kannada_relative_deadline / baseline_det: owner None != 'Shreya'; due None != '2026-11-05' pred “Budget report” owner=None due=None state=needs_clarification
- H03_kannada_relative_deadline / candidate: due '2026-11-09' != '2026-11-05' pred “Budget report” owner=Shreya due=2026-11-09 state=proposed
- H04_hindi_relative_deadline / baseline: due '2026-11-09' != '2026-11-06' pred “Client presentation” owner=Aman due=2026-11-09 state=proposed
- H04_hindi_relative_deadline / baseline_det: due None != '2026-11-06' pred “Client presentation” owner=Aman due=None state=proposed
- H04_hindi_relative_deadline / candidate: missing (false negative)
- H05_cross_meeting_pickup / baseline: not linked to TASK-305 (duplicate/new task instead) pred “Onboarding documentation” owner=Arjun due=None state=proposed
- H05_cross_meeting_pickup / baseline: check failed: updates_existing_task
- H05_cross_meeting_pickup / baseline: check failed: no_duplicate_task
- H05_cross_meeting_pickup / baseline_det: not linked to TASK-305 (duplicate/new task instead) pred “Onboarding documentation” owner=Arjun due=None state=proposed
- H05_cross_meeting_pickup / baseline_det: check failed: updates_existing_task
- H05_cross_meeting_pickup / baseline_det: check failed: no_duplicate_task
- H08_approval_dependency / baseline: due '2026-11-11' != '2026-11-05' pred “Approve the final design” owner=Anita due=2026-11-11 state=proposed
- H08_approval_dependency / baseline: owner None != 'Ravi' pred “Start the build” owner=None due=None state=proposed
- H08_approval_dependency / baseline_det: owner None != 'Ravi' pred “Start the build” owner=None due=None state=needs_clarification
- H09_perhaps_someone / baseline: unexpected active item (false positive) pred “Look into the analytics dashboard” owner=None due=None state=proposed
- H09_perhaps_someone / baseline: check failed: no_active_analytic_dashboard
- H09_perhaps_someone / baseline_det: unexpected active item (false positive) pred “Look into the analytics dashboard” owner=None due=None state=needs_clarification
- H09_perhaps_someone / baseline_det: check failed: no_active_analytic_dashboard
- H10_unanswered_request / baseline: missing (false negative)
- H10_unanswered_request / baseline: check failed: clarification_raised
- H10_unanswered_request / baseline_det: missing (false negative)
- H10_unanswered_request / baseline_det: check failed: clarification_raised
- H12_group_owner_deadline / baseline: due '2026-11-08' != '2026-11-09'; state 'proposed' != 'needs_clarification' pred “Update status pages” owner=None due=2026-11-08 state=proposed
- H12_group_owner_deadline / baseline: check failed: clarification_raised
- H12_group_owner_deadline / baseline_det: check failed: clarification_raised
- H12_group_owner_deadline / candidate: due None != '2026-11-09' pred “Update status pages” owner=None due=None state=needs_clarification

