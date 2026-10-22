# Baseline vs candidate — synthetic fixtures (20261022T172742Z_ollama_qwen3-8b_replay_posthoc-fold-v3)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v1
- Mode: **replay** (raw responses from `evaluation/results/20261022T165631Z_ollama_qwen3-8b.json`)
- Started 2026-10-22T17:27:42.905285+00:00, wall time 0.0s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.333 | 0.667 | 0.909 |
| strict recall | 0.364 | 0.727 | 0.909 |
| strict F1 | 0.348 | 0.696 | 0.909 |
| lenient (title-only) F1 | 0.957 | 0.957 | 1.0 |
| owner errors | 3 | 2 | 1 |
| due-date errors | 4 | 0 | 0 |
| state errors | 1 | 0 | 0 |
| false-positive active items | 1 | 1 | 0 |
| dependencies correct | 1/2 | 1/2 | 2/2 |
| safety checks passed | 5/8 | 5/8 | 8/8 |
| clarifications on clean cases | 0 | 0 | 1 |
| cases fully correct | 6/12 | 7/12 | 11/12 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| T01_direct | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T02_reassign | PASS (2/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) |
| T03_cancel | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T04_tentative | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T05_dependencies | FAIL (0/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) | FAIL (1/2, fp 0, q 1) |
| T06_kannada_mix | FAIL (0/2, fp 0, q 1) | FAIL (1/2, fp 0, q 1) | PASS (2/2, fp 0, q 0) |
| T07_deadline_correction | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T08_cross_meeting | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T09_ambiguous_cancel | FAIL (0/0, fp 1, q 0) | FAIL (0/0, fp 1, q 0) | PASS (0/0, fp 0, q 2) |
| T10_prompt_injection | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T11_unmapped_first_person | FAIL (0/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| T12_assignment_vs_task_cancel | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |

Mismatches:

- T01_direct / baseline: due '2026-10-22' != '2026-10-23' pred “Complete the authentication API” owner=Rahul due=2026-10-22 state=proposed
- T05_dependencies / baseline: due '2026-10-22' != '2026-10-23' pred “Own the backend API” owner=Rahul due=2026-10-22 state=proposed
- T05_dependencies / baseline: owner None != 'Samiksha' pred “Start testing” owner=None due=None state=proposed
- T05_dependencies / baseline_det: owner None != 'Samiksha' pred “Start testing” owner=None due=None state=needs_clarification
- T05_dependencies / candidate: owner None != 'Samiksha' pred “Start testing” owner=None due=None state=needs_clarification
- T06_kannada_mix / baseline: due '2026-10-22' != '2026-10-23' pred “Complete API development” owner=Rahul due=2026-10-22 state=proposed
- T06_kannada_mix / baseline: blocked_by [] != 'Finish API' pred “Start testing” owner=Samiksha due=None state=proposed
- T06_kannada_mix / baseline_det: blocked_by [] != 'Finish API' pred “Start testing” owner=Samiksha due=None state=proposed
- T08_cross_meeting / baseline: owner None != 'Samiksha' pred “Login QA” owner=None due=None state=proposed
- T08_cross_meeting / baseline: check failed: updates_existing_task
- T08_cross_meeting / baseline_det: owner None != 'Samiksha' pred “Login QA” owner=None due=None state=needs_clarification
- T08_cross_meeting / baseline_det: check failed: updates_existing_task
- T09_ambiguous_cancel / baseline: unexpected active item (false positive) pred “QA testing” owner=Samiksha due=None state=proposed
- T09_ambiguous_cancel / baseline: check failed: clarification_raised
- T09_ambiguous_cancel / baseline_det: unexpected active item (false positive) pred “QA testing” owner=Samiksha due=None state=proposed
- T09_ambiguous_cancel / baseline_det: check failed: clarification_raised
- T11_unmapped_first_person / baseline: owner 'SPEAKER_02' != None; due '2026-10-22' != '2026-10-23'; state 'proposed' != 'needs_clarification' pred “Conduct security review” owner=SPEAKER_02 due=2026-10-22 state=proposed
- T11_unmapped_first_person / baseline: check failed: clarification_raised
- T11_unmapped_first_person / baseline_det: check failed: clarification_raised

