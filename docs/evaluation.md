# Evaluation

There are two separate evaluations. They must not be confused.

| | Synthetic engineering fixtures | Official PS 5.3 evaluation |
|---|---|---|
| Data | 12 synthetic text cases from the starter kit (`evaluation/fixtures/`) | ≥3 real, consented meeting recordings, ≥1 code-mixed |
| Purpose | Test whether the reconciliation engine beats direct extraction | WER, speaker attribution, action precision/recall vs human annotation, human-rated summaries |
| Status | **Run** (results below) | **Not done.** No real recordings were provided during development. Tooling is ready (`evaluation/real_eval.py`). |

## 1. Baseline vs reconciliation engine (synthetic fixtures)

### Method

- Rubric and per-case match keys were committed **before** the first run (commit
  `c989a75`): `evaluation/RUBRIC.md`, `evaluation/annotations/fixture_match_keys.json`.
- Three pipelines are run on the same model, temperature 0 and seed 7:
  - `baseline`: one call returns the final action items.
  - `baseline_det`: the same output plus deterministic date resolution and
    anonymous-owner clearing. This ablation isolates the event fold.
  - `candidate`: one call returns typed events, then the deterministic `reconcile()`.
- Prompts share the rules text and a different-domain worked example.
- The model was a local Ollama model on an Intel i9 CPU, because no Gemini key was
  available. Absolute numbers say nothing about `gemini-3.8-flash`.
- One trial per run. Temperature 0 with a fixed seed makes repeats uninformative, so a
  second model was used for robustness instead.
- Reproduce with `backend/.venv/bin/python evaluation/run_eval.py --provider ollama
  --model qwen3:8b`. Results are written to `evaluation/results/<run>.json|md`, with
  every raw model response.

### Pre-registered results (primary)

Code of `c989a75`/`b956ceb`, prompt v1.

| metric | baseline | baseline + date rules | **candidate** |
|---|---|---|---|
| **qwen3:8b** (`20261022T165631Z`) | | | |
| strict precision / recall / F1 | 0.333 / 0.364 / 0.348 | 0.667 / 0.727 / 0.696 | **0.818 / 0.818 / 0.818** |
| owner errors / due-date errors | 3 / 4 | 2 / 0 | 1 / 0 |
| false-positive active items | 1 | 1 | 0 |
| safety checks passed | 5/8 | 5/8 | **8/8** |
| dependencies correct | 1/2 | 1/2 | **0/2** |
| cases fully correct | 6/12 | 7/12 | **10/12** |
| **llama3.1:8b** (`20261022T170639Z`) | | | |
| strict precision / recall / F1 | 0.643 / 0.818 / 0.720 | 0.714 / 0.909 / 0.800 | **1.000 / 0.818 / 0.900** |
| owner errors / due-date errors | 2 / 0 | 1 / 0 | 0 / 0 |
| false-positive active items | 3 | 3 | 0 |
| safety checks passed | 4/8 | 4/8 | **8/8** |
| dependencies correct | 2/2 | 2/2 | **0/0** (both dependent tasks missed) |
| cases fully correct | 8/12 | 8/12 | **10/12** |

### What the numbers say, and what they don't

- **Where the candidate helped, on both models:**
  - T08: updated TASK-101 instead of leaving it, or duplicating it.
  - T09: did not act on "cancel the old testing plan" and asked instead.
  - T11: asked for the anonymous speaker's identity instead of assigning to `SPEAKER_02`.
  - T03, on llama: no ghost task after cancellation.
  - These are the failure classes the thesis targets. The baseline failed T09 on both
    models, with false-positive "QA testing" items and no question raised.
- **Deterministic dates explain about half the gain on qwen3:8b.** The model computed
  "by Friday" as 2026-10-22 instead of 2026-10-23 in four cases. `baseline_det` shows
  that this part is cheap to add to any pipeline. The remaining gain (0.696 → 0.818)
  and all of the safety gain come from the event fold.
- **The candidate was worse at dependencies.**
  - On qwen3:8b, the model put the prerequisite on a PROPOSE event, which the v1 fold
    ignored.
  - On llama3.1:8b, the model never proposed the dependent testing task in T05 (it
    emitted a self-dependency) or T06 (no event for the Kannada line). The baseline
    captured both. The richer event format costs recall here.
- **Small sample:** 12 synthetic cases and 11 expected items. A single case moves F1 by
  about 0.08. These are engineering signals, not a benchmark.

### Post-hoc changes (made after seeing results; same fixtures, so overfitting risk)

Each change is a separate commit with a regression test. Replays re-score the **same
recorded model responses** with the newer deterministic rules; no new model calls.

| Commit | Change | Effect (replay of the qwen3:8b v1 responses) |
|---|---|---|
| `b956ceb` | Honour `depends_on_key` on any work-item event. Conditional timing ("aadmele", "after X") is not a deadline. | dependencies 0/2 → 1/2; strict F1 unchanged 0.818 |
| `59ed990` | Prompt v2 spells out ADD_DEPENDENCY. Uncovered-segment safety net. | requires a new live run (below) |
| `4a88d15` | Owner restatement guard. Rule-based dependency cues (once/after X is ready, *aadmele*, *ke baad*), never guessing on ties. | strict F1 0.818 → **0.909**, dependencies 2/2, fully correct 11/12 (`20261022T172742Z…replay_posthoc-fold-v3`). llama3.1 unchanged: rules cannot recover items the model never proposed. |

### 1b. Live runs with prompt v2 and the v3 fold (post-hoc; new model calls)

| metric | baseline | baseline + date rules | **candidate** |
|---|---|---|---|
| **qwen3:8b** (`20261022T172800Z…prompt-v2`) | | | |
| strict precision / recall / F1 | 0.417 / 0.455 / 0.435 | 0.667 / 0.727 / 0.696 | **0.909 / 0.909 / 0.909** |
| owner errors / due-date errors | 3 / 3 | 2 / 0 | 0 / 0 |
| safety checks passed | 5/8 | 5/8 | **8/8** |
| dependencies correct | 1/2 | 1/2 | 1/2 |
| cases fully correct | 7/12 | 7/12 | **11/12** |

**Run-to-run variance.** The baseline prompt was *identical* in the v1 and v2 runs, yet
baseline strict F1 moved from 0.348 to 0.435. Local CPU inference is not bit-exact even at
temperature 0 with a fixed seed. Concurrent requests to the same Ollama server, which
happened during these runs, are a likely cause. Treat differences of roughly ±0.1 F1 on
these 11 items as noise. The safety-check gap (8/8 vs 4–5/8) has been stable across every
run so far.

### Gate decision

The candidate showed a meaningful correctness benefit on the failure classes it targets
(cross-meeting identity, ambiguous cancellation, anonymous speakers, ghost tasks) on
both models. Its cost is weaker dependency recall with the event format on a weaker
model. It was kept, with the mitigations above, and with the baseline-style
"uncovered lines" check in the review UI so missed commitments are visible to the
organiser.

## 2. Official evaluation on real meetings (not yet done)

Requirement: ≥3 real meeting samples, ≥1 code-mixed. Report WER, action precision/recall
against human annotations, speaker-label quality, and human-rated summary quality.

**Status: no real recordings were available during development. Nothing here is
claimed.** Steps for the team:

1. **Record** three short meetings (5–15 min) with explicit consent from every
   participant: at least one in Kannada-English or Hindi-English. Use a phone or
   laptop; mp3/m4a/wav are fine.
2. **Set `SARVAM_API_KEY`** (and ideally `GEMINI_API_KEY`) in `.env`. Run
   `Diagnostics → Run live test`, then upload each recording through *Add a meeting*.
   Sarvam runs with `mode=codemix` and diarization.
3. **Annotate before looking at the system's actions.** Per meeting, create
   `evaluation/private/<name>/` (git-ignored) containing:
   - `reference_transcript.json`: a human-corrected transcript with speaker names and
     start/end times. Write English words in Latin script and Indic words in the script
     the STT produced. This is the mixed-script policy: words are compared as written,
     so annotate in the STT's output convention.
   - `reference_actions.json`: each agreed action with owner, due date and
     `match_keywords`.
   - `meeting.json`: `{"meeting_id": <id>, "code_mixed": true|false, "languages": [...]}`.
4. **Rate the summaries.** Two people who did not build the system rate each
   *prepared* summary 1–5 for factuality, coverage and clarity, and their roles go in
   `ratings.json`. Rubric:
   - 5 = no error or omission;
   - 3 = one notable omission or minor error;
   - 1 = misleading.
5. **Run** `backend/.venv/bin/python evaluation/real_eval.py report
   evaluation/private/*`. Commit the generated JSON only if it contains no private text.
   It contains metrics, the speaker label mapping and action titles; check it first.

Metric definitions:

| Metric | Definition |
|---|---|
| WER | (S + D + I) / N over the whole meeting. Lowercase and Unicode NFC. Letters, digits and combining marks are kept (Indic vowel signs are preserved). Punctuation is removed. No transliteration. |
| Action precision / recall | Lenient: keyword match on the title. Strict: also the same owner, and the same due date when annotated. Computed on the *proposed* items before organiser edits, so the model plus engine is measured, not the human. |
| Speaker attribution accuracy | Share of reference speech time whose hypothesis label maps to the correct person, after a greedy one-to-one mapping of diarization labels to reference speakers. Timestamps are segment-level, so boundary error is included. |
