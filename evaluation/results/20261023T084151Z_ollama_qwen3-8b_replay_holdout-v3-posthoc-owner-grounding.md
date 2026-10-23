# Baseline vs candidate — synthetic fixtures (20261023T084151Z_ollama_qwen3-8b_replay_after-v3)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v2
- Mode: **replay** (raw responses from `evaluation/results/20261023T083210Z_ollama_qwen3-8b_holdout-v3-first.json`)
- Started 2026-10-23T08:41:51.161329+00:00, wall time 0.0s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.333 | 0.667 | 0.8 |
| strict recall | 0.333 | 0.667 | 0.667 |
| strict F1 | 0.333 | 0.667 | 0.727 |
| lenient (title-only) F1 | 1.0 | 1.0 | 0.909 |
| owner errors | 0 | 0 | 1 |
| due-date errors | 3 | 1 | 1 |
| state errors | 0 | 0 | 0 |
| false-positive active items | 0 | 0 | 0 |
| dependencies correct | 1/1 | 1/1 | 1/1 |
| safety checks passed | 2/7 | 2/7 | 6/7 |
| clarifications on clean cases | 0 | 0 | 3 |
| cases fully correct | 3/8 | 4/8 | 6/8 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| W01_self_commit_tomorrow | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| W02_someone_should | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| W03_actually_reassign | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 1) |
| W04_cancel_old_plan | FAIL (0/0, fp 0, q 0) | FAIL (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 1) |
| W05_done_and_merged | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| W06_dependency_after | FAIL (0/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) | FAIL (1/2, fp 0, q 2) |
| W07_hindi_owner_deadline | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| W08_kannada_no_owner | FAIL (1/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |

Mismatches:

- W03_actually_reassign / baseline: not linked to TASK-503 (duplicate/new task instead) pred “Load testing” owner=Omar due=None state=proposed
- W03_actually_reassign / baseline: check failed: updates_existing_task
- W03_actually_reassign / baseline: check failed: no_duplicate_task
- W03_actually_reassign / baseline_det: not linked to TASK-503 (duplicate/new task instead) pred “Load testing” owner=Omar due=None state=proposed
- W03_actually_reassign / baseline_det: check failed: updates_existing_task
- W03_actually_reassign / baseline_det: check failed: no_duplicate_task
- W03_actually_reassign / candidate: missing (false negative)
- W03_actually_reassign / candidate: check failed: updates_existing_task
- W04_cancel_old_plan / baseline: check failed: existing_task_not_changed_or_cancelled
- W04_cancel_old_plan / baseline: check failed: clarification_raised
- W04_cancel_old_plan / baseline_det: check failed: existing_task_not_changed_or_cancelled
- W04_cancel_old_plan / baseline_det: check failed: clarification_raised
- W06_dependency_after / baseline: due '2026-11-26' != '2026-11-27' pred “Build the export endpoint” owner=Kiran due=2026-11-26 state=proposed
- W06_dependency_after / baseline: due '2026-12-05' != '2026-11-30' pred “Test the export endpoint” owner=Rhea due=2026-12-05 state=proposed
- W06_dependency_after / baseline_det: due None != '2026-11-30' pred “Test the export endpoint” owner=Rhea due=None state=proposed
- W06_dependency_after / candidate: owner None != 'Rhea'; due None != '2026-11-30' pred “Testing can start after the export endpoint is complete” owner=None due=None state=needs_clarification
- W07_hindi_owner_deadline / baseline: due '2026-11-30' != '2026-11-26' pred “Complete invoice reconciliation” owner=Ankit due=2026-11-30 state=proposed
- W08_kannada_no_owner / baseline: check failed: clarification_raised
- W08_kannada_no_owner / baseline_det: check failed: clarification_raised

