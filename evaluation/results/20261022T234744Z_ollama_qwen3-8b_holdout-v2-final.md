# Baseline vs candidate — synthetic fixtures (20261022T234744Z_ollama_qwen3-8b_holdout-v2-final)

> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.

- Provider / model: **ollama / qwen3:8b** (same for all pipelines)
- temperature=0.0, seed=7, trials=1, prompt version=v2
- Mode: **live**
- Started 2026-10-22T23:47:44.497645+00:00, wall time 496.6s, host Darwin x86_64

## Aggregate (micro-averaged over all cases and trials)

| metric | baseline | baseline_det | candidate |
|---|---|---|---|
| strict precision | 0.5 | 0.75 | 0.625 |
| strict recall | 0.5 | 0.75 | 0.625 |
| strict F1 | 0.5 | 0.75 | 0.625 |
| lenient (title-only) F1 | 0.875 | 0.875 | 0.875 |
| owner errors | 1 | 0 | 1 |
| due-date errors | 2 | 1 | 1 |
| state errors | 2 | 0 | 0 |
| false-positive active items | 1 | 1 | 1 |
| dependencies correct | 1/1 | 1/1 | 0/1 |
| safety checks passed | 5/10 | 5/10 | 10/10 |
| clarifications on clean cases | 0 | 0 | 1 |
| cases fully correct | 3/10 | 3/10 | 7/10 |

`baseline_det` = baseline output + deterministic date resolution and anonymous-owner clearing (ablation isolating the event fold).

## Per case

### Trial 1

| case | baseline | baseline_det | candidate |
|---|---|---|---|
| V01_hindi_completion | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 0) |
| V02_kannada_not_finished | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 1) |
| V03_everyone_should | FAIL (0/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| V04_handover_with_date | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| V05_hindi_sequence | PASS (2/2, fp 0, q 0) | PASS (2/2, fp 0, q 0) | FAIL (1/2, fp 0, q 0) |
| V06_scrap_old_approach | FAIL (0/0, fp 0, q 0) | FAIL (0/0, fp 0, q 0) | PASS (0/0, fp 0, q 1) |
| V07_might_be_worth | FAIL (0/0, fp 1, q 0) | FAIL (0/0, fp 1, q 0) | PASS (0/0, fp 0, q 0) |
| V08_anonymous_volunteer | FAIL (0/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 1) |
| V09_fixed_then_new_task | FAIL (1/1, fp 0, q 0) | FAIL (1/1, fp 0, q 0) | PASS (1/1, fp 0, q 0) |
| V10_kannada_tomorrow | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 0, q 0) | FAIL (0/1, fp 1, q 0) |

Mismatches:

- V02_kannada_not_finished / baseline: due '2026-11-20' != '2026-11-16' pred “Sponsor deck” owner=Ananya due=2026-11-20 state=proposed
- V02_kannada_not_finished / baseline_det: due None != '2026-11-16' pred “Sponsor deck” owner=Ananya due=None state=proposed
- V02_kannada_not_finished / candidate: missing (false negative)
- V03_everyone_should / baseline: due '2026-11-15' != '2026-11-16'; state 'proposed' != 'needs_clarification' pred “Submit timesheets” owner=None due=2026-11-15 state=proposed
- V03_everyone_should / baseline: check failed: clarification_raised
- V03_everyone_should / baseline_det: check failed: clarification_raised
- V05_hindi_sequence / candidate: blocked_by [] != 'Generate API keys' pred “Integration test” owner=Tara due=None state=proposed
- V06_scrap_old_approach / baseline: check failed: clarification_raised
- V06_scrap_old_approach / baseline_det: check failed: clarification_raised
- V07_might_be_worth / baseline: unexpected active item (false positive) pred “Check the backup logs” owner=None due=None state=proposed
- V07_might_be_worth / baseline: check failed: no_active_backup_log
- V07_might_be_worth / baseline_det: unexpected active item (false positive) pred “Check the backup logs” owner=None due=None state=needs_clarification
- V07_might_be_worth / baseline_det: check failed: no_active_backup_log
- V08_anonymous_volunteer / baseline: owner 'SPEAKER_03' != None; state 'proposed' != 'needs_clarification' pred “Process vendor invoices” owner=SPEAKER_03 due=2026-11-14 state=proposed
- V08_anonymous_volunteer / baseline: check failed: clarification_raised
- V08_anonymous_volunteer / baseline_det: check failed: clarification_raised
- V09_fixed_then_new_task / baseline: check failed: op_complete_TASK-409
- V09_fixed_then_new_task / baseline_det: check failed: op_complete_TASK-409
- V10_kannada_tomorrow / baseline: missing (false negative)
- V10_kannada_tomorrow / baseline_det: missing (false negative)
- V10_kannada_tomorrow / candidate: owner 'Chair' != 'Divya'; due None != '2026-11-14' pred “Poster print” owner=Chair due=None state=proposed
- V10_kannada_tomorrow / candidate: unexpected active item (false positive) pred “Sari, naale maadthini” owner=Divya due=None state=proposed

