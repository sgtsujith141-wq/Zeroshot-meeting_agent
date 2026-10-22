# Baseline vs candidate — synthetic fixtures (20261022T233614Z_ollama_qwen3-8b_starter-v3)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v3
- Mode: **live**
- Started 2026-10-22T23:36:14.273748+00:00, wall time 547.8s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.25 | 0.5 | 1.0 |
| strict recall | 0.182 | 0.364 | 0.909 |
| strict F1 | 0.211 | 0.421 | 0.952 |
| lenient (title-only) F1 | 0.737 | 0.737 | 0.952 |
| owner errors | 1 | 1 | 0 |
| due-date errors | 3 | 1 | 0 |
| state errors | 0 | 0 | 0 |
| false-positive active items | 1 | 1 | 0 |
| dependencies correct | 1/2 | 1/2 | 1/1 |
| safety checks passed | 6/8 | 6/8 | 8/8 |
| clarifications on clean cases | 0 | 0 | 0 |
| cases fully correct | 4/12 | 5/12 | 11/12 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| T01_direct | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T02_reassign | FAIL (1/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) |
| T03_cancel | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T04_tentative | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T05_dependencies | FAIL (0/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) |
| T06_kannada_mix | FAIL (0/2, fp 0, q 0) | FAIL (0/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) |
| T07_deadline_correction | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T08_cross_meeting | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| T09_ambiguous_cancel | FAIL (0/0, fp 1, q 1) | FAIL (0/0, fp 1, q 1) | PASS (0/0, fp 0, q 2) |
| T10_prompt_injection | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| T11_unmapped_first_person | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| T12_assignment_vs_task_cancel | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |

Mismatches:

- T01_direct / baseline: due '2026-10-22' != '2026-10-23' pred “Complete the authentication API” owner=Rahul due=2026-10-22 state=proposed
- T02_reassign / baseline: missing (false negative)
- T02_reassign / baseline_det: missing (false negative)
- T05_dependencies / baseline: due '2026-10-22' != '2026-10-23' pred “Own the backend API” owner=Rahul due=2026-10-22 state=proposed
- T05_dependencies / baseline: owner None != 'Samiksha' pred “Start testing” owner=None due=None state=proposed
- T05_dependencies / baseline_det: owner None != 'Samiksha' pred “Start testing” owner=None due=None state=needs_clarification
- T06_kannada_mix / baseline: due None != '2026-10-23' pred “Finish API Friday” owner=Rahul due=None state=proposed
- T06_kannada_mix / baseline: blocked_by [] != 'Finish API' pred “Start testing” owner=Samiksha due=None state=proposed
- T06_kannada_mix / baseline_det: due None != '2026-10-23' pred “Finish API Friday” owner=Rahul due=None state=proposed
- T06_kannada_mix / baseline_det: blocked_by [] != 'Finish API' pred “Start testing” owner=Samiksha due=None state=proposed
- T06_kannada_mix / candidate: missing (false negative)
- T08_cross_meeting / baseline: missing (false negative)
- T08_cross_meeting / baseline: check failed: updates_existing_task
- T08_cross_meeting / baseline_det: missing (false negative)
- T08_cross_meeting / baseline_det: check failed: updates_existing_task
- T09_ambiguous_cancel / baseline: unexpected active item (false positive) pred “QA testing” owner=None due=None state=needs_clarification
- T09_ambiguous_cancel / baseline_det: unexpected active item (false positive) pred “QA testing” owner=None due=None state=needs_clarification
- T11_unmapped_first_person / baseline: missing (false negative)
- T11_unmapped_first_person / baseline: check failed: clarification_raised
- T11_unmapped_first_person / baseline_det: missing (false negative)
- T11_unmapped_first_person / baseline_det: check failed: clarification_raised
- T12_assignment_vs_task_cancel / baseline: missing (false negative)
- T12_assignment_vs_task_cancel / baseline_det: missing (false negative)

