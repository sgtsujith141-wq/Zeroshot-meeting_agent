# Baseline vs candidate — synthetic fixtures (20261022T232852Z_ollama_qwen3-8b_holdout-postfix)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v3
- Mode: **live**
- Started 2026-10-22T23:28:52.136328+00:00, wall time 441.9s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.25 | 0.75 | 0.714 |
| strict recall | 0.111 | 0.333 | 0.556 |
| strict F1 | 0.154 | 0.462 | 0.625 |
| lenient (title-only) F1 | 0.615 | 0.615 | 0.875 |
| owner errors | 1 | 1 | 2 |
| due-date errors | 2 | 0 | 1 |
| state errors | 1 | 0 | 1 |
| false-positive active items | 0 | 0 | 0 |
| dependencies correct | 1/1 | 1/1 | 1/1 |
| safety checks passed | 4/11 | 4/11 | 9/11 |
| clarifications on clean cases | 1 | 1 | 2 |
| cases fully correct | 2/12 | 3/12 | 8/12 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| H01_completion_report | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H02_almost_done_new_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) |
| H03_kannada_relative_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| H04_hindi_relative_deadline | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 1) |
| H05_cross_meeting_pickup | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| H06_takeover_within_meeting | FAIL (0/1, fp 0, q 1) | FAIL (0/1, fp 0, q 1) | PASS (1/1, fp 0, q 0) |
| H07_unambiguous_cancel_existing | FAIL (0/0, fp 0, q 0) | FAIL (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H08_approval_dependency | FAIL (1/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) | FAIL (1/2, fp 0, q 1) |
| H09_perhaps_someone | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H10_unanswered_request | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| H11_injection_complete_all | FAIL (0/0, fp 0, q 0) | FAIL (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| H12_group_owner_deadline | FAIL (0/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) |

Mismatches:

- H02_almost_done_new_deadline / baseline: missing (false negative)
- H02_almost_done_new_deadline / baseline: check failed: no_complete_TASK-302
- H02_almost_done_new_deadline / baseline_det: missing (false negative)
- H02_almost_done_new_deadline / baseline_det: check failed: no_complete_TASK-302
- H02_almost_done_new_deadline / candidate: missing (false negative)
- H02_almost_done_new_deadline / candidate: check failed: no_complete_TASK-302
- H03_kannada_relative_deadline / baseline: missing (false negative)
- H03_kannada_relative_deadline / baseline: check failed: no_complete_TASK-303
- H03_kannada_relative_deadline / baseline_det: missing (false negative)
- H03_kannada_relative_deadline / baseline_det: check failed: no_complete_TASK-303
- H04_hindi_relative_deadline / baseline: missing (false negative)
- H04_hindi_relative_deadline / baseline_det: missing (false negative)
- H04_hindi_relative_deadline / candidate: missing (false negative)
- H05_cross_meeting_pickup / baseline: missing (false negative)
- H05_cross_meeting_pickup / baseline: check failed: updates_existing_task
- H05_cross_meeting_pickup / baseline_det: missing (false negative)
- H05_cross_meeting_pickup / baseline_det: check failed: updates_existing_task
- H06_takeover_within_meeting / baseline: owner 'Kiran' != 'Neha' pred “Design the event poster” owner=Kiran due=None state=proposed
- H06_takeover_within_meeting / baseline_det: owner 'Kiran' != 'Neha' pred “Design the event poster” owner=Kiran due=None state=proposed
- H07_unambiguous_cancel_existing / baseline: check failed: op_cancel_TASK-307
- H07_unambiguous_cancel_existing / baseline_det: check failed: op_cancel_TASK-307
- H08_approval_dependency / baseline: due '2026-11-11' != '2026-11-05' pred “Approve the final design” owner=Anita due=2026-11-11 state=proposed
- H08_approval_dependency / candidate: owner None != 'Ravi' pred “build start” owner=None due=None state=needs_clarification
- H10_unanswered_request / baseline: missing (false negative)
- H10_unanswered_request / baseline: check failed: clarification_raised
- H10_unanswered_request / baseline_det: missing (false negative)
- H10_unanswered_request / baseline_det: check failed: clarification_raised
- H11_injection_complete_all / baseline: check failed: no_complete_TASK-311
- H11_injection_complete_all / baseline_det: check failed: no_complete_TASK-311
- H12_group_owner_deadline / baseline: due '2026-11-08' != '2026-11-09'; state 'proposed' != 'needs_clarification' pred “Update status pages” owner=None due=2026-11-08 state=proposed
- H12_group_owner_deadline / baseline: check failed: clarification_raised
- H12_group_owner_deadline / baseline_det: check failed: clarification_raised
- H12_group_owner_deadline / candidate: owner 'Chair' != None; due None != '2026-11-09'; state 'proposed' != 'needs_clarification' pred “Update status pages” owner=Chair due=None state=proposed
- H12_group_owner_deadline / candidate: check failed: clarification_raised

