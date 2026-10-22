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

| **llama3.1:8b** (`20261022T174138Z…prompt-v2`) | | | |
| strict precision / recall / F1 | 0.643 / 0.818 / 0.720 | 0.714 / 0.909 / 0.800 | **0.900 / 0.818 / 0.857** |
| owner errors / false positives | 2 / 3 | 1 / 3 | 1 / 0 |
| safety checks passed | 4/8 | 4/8 | **7/8** |
| dependencies correct | 2/2 | 2/2 | 1/1 |
| cases fully correct | 8/12 | 8/12 | **9/12** |

**Prompt v2 did not help llama3.1. It was slightly worse than v1** (0.90 → 0.857
F1, 8/8 → 7/8 safety). In T09 the model emitted a `CANCEL` with no target. The fold
rejected it, so TASK-102 was safely untouched, but no clarification question was
raised, and that is the first failed safety check for the candidate in any run. Since
then, a cancellation without a target becomes an explicit open question for the
organiser (commit `923e8d3`, product behaviour). Open questions are deliberately **not** counted
by the rubric, so the recorded 7/8 stands. Replays of all four recorded runs with the
final code give the same scores as in the tables.

**Run-to-run variance.** The baseline prompt was *identical* in the v1 and v2 runs, yet
baseline strict F1 moved from 0.348 to 0.435. Local CPU inference is not bit-exact even at
temperature 0 with a fixed seed. Concurrent requests to the same Ollama server, which
happened during these runs, are a likely cause. Treat differences of roughly ±0.1 F1 on
these 11 items as noise. The safety-check gap has held in all four live runs (candidate 8/8, 8/8, 8/8, 7/8 vs
baseline 4–5/8).

### 1c. Holdout v1: unseen cases for the 2026-10-23 defect fixes

`fixtures/holdout_v1.json` holds 12 new cases with new names, domains, phrasing and a
Wednesday meeting date. It and rubric v2 were committed in `2fa9e69`, **before** any run
on them. Rubric v2 scores completing or cancelling approved work as an operation, not as
an active item. Model qwen3:8b, temperature 0, seed 7.

| candidate | strict F1 | safety | fully correct |
|---|---|---|---|
| pre-fix code (`2fa9e69`, prompt v2) | 0.706 | 11/11 | 9/12 |
| fixes as committed (`e78d265`: fold fixes **and** prompt v3) | **0.625** | **9/11** | 8/12 |
| ablation: pre-fix model outputs replayed through the `e78d265` fold | 0.824 | 11/11 | 10/12 |

Baseline (pre-fix): strict F1 0.111, safety 6/11. Baseline + date rules: 0.333.

- **The deterministic fixes helped. Prompt v3 hurt.** Its new completion example led the
  model to report "almost done" as complete (H02) and to emit `SELF` for "We will all…"
  (H12).
- On the starter-kit cases, the same prompt v3 reached the best-ever 0.952. Improving on
  the tuned set while getting worse on unseen cases is an overfitting signal.
- Prompt v3 was therefore **reverted** (`43a73c7`; extraction prompts byte-identical to
  v2). Two guards that check the model's claim against the spoken words were added:
  - an explicit completion contradicted by "almost / will…" is not applied;
  - `SELF` on group speech without a first-person singular is not assigned to the
    speaker.
- Those guards were designed after seeing holdout v1, so **holdout v1 is contaminated
  from `43a73c7` on**. A fresh holdout v2 was written after the code freeze.

### 1d. Holdout v2: fresh, clean measurement of the final code

`fixtures/holdout_v2.json` holds 10 cases written **after** the code was frozen at
`43a73c7` and committed (`6ae4778`) before any run. It uses a Friday meeting date and
Kannada/Hindi phrasings unlike the rules' examples. Run `20261022T234744Z_ollama_qwen3-8b_holdout-v2-final`: qwen3:8b, prompt v2.

| metric | baseline | baseline + date rules | **candidate** |
|---|---|---|---|
| strict precision / recall / F1 | 0.50 / 0.50 / 0.50 | 0.75 / 0.75 / **0.75** | 0.625 / 0.625 / 0.625 |
| lenient (title-only) F1 | 0.875 | 0.875 | 0.875 |
| owner / due-date errors | 1 / 2 | 0 / 1 | 1 / 1 |
| false-positive active items | 1 | 1 | 1 |
| dependencies correct | 1/1 | 1/1 | 0/1 |
| safety checks passed | 5/10 | 5/10 | **10/10** |
| cases fully correct | 3/10 | 3/10 | **7/10** |

**What this clean measurement supports:**
- On fresh cases the engine's advantage is **safety and whole-meeting correctness**: 10/10
  vs 5/10 safety, and 7/10 vs 3/10 cases fully correct. It produced no ghost tasks, did
  not act on the ambiguous "scrap the old approach", did not promote "might be worth
  someone…", and did not assign work to the anonymous SPEAKER_03.
- On **item-level extraction it is not better**: baseline plus deterministic date rules
  scored a higher strict F1 (0.75 vs 0.625).
- The candidate's misses are model interpretation errors on code-mixed lines:
  - V02 "innu mugidilla, Monday kodthini" (not finished, Monday): change missed;
  - V05 "uske baad" (after that): dependency missed;
  - V10 "naale maadbeku" (must do tomorrow): owner misread, plus a false positive.
- One model, one trial, 10 cases: differences of about ±0.1 F1 are within run-to-run
  noise (see 1b).

**Post-measurement change.** An acceptance from an unmapped speaker now keeps an
explicitly named owner. This came from the live audio check, not from a holdout.
Replaying every recorded run (starter kit, holdout v1, holdout v2) with the final code
gives **unchanged** scores, including holdout v2 at 0.625 / 10/10.

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
5. **Run**
   ```
   backend/.venv/bin/python evaluation/real_eval.py init evaluation/private/<name> --meeting-id <id>
   backend/.venv/bin/python evaluation/real_eval.py export evaluation/private/<name>
   backend/.venv/bin/python evaluation/real_eval.py report evaluation/private/*
   ```
   - `init` writes **empty** templates.
   - `export` saves the system's actual transcript, actions, decisions and summary as
     `system_*` files.
   - `report` prints every metric that has no annotation as **NOT MEASURED**, and checks
     "≥3 real, ≥1 code-mixed". Commit the generated JSON only if it contains no private text.
   It contains metrics, the speaker label mapping and action titles; check it first.

Metric definitions:

| Metric | Definition |
|---|---|
| WER | (S + D + I) / N over the whole meeting. Lowercase and Unicode NFC. Letters, digits and combining marks are kept (Indic vowel signs are preserved). Punctuation is removed. No transliteration. |
| Action precision / recall | Lenient: keyword match on the title. Strict: also the same owner, and the same due date when annotated. Computed on the *proposed* items before organiser edits, so the model plus engine is measured, not the human. |
| Speaker attribution accuracy | Share of reference speech time whose hypothesis label maps to the correct person, after a greedy one-to-one mapping of diarization labels to reference speakers. Timestamps are segment-level, so boundary error is included. |

## 3. Speech-to-text verification (not the official evaluation)

| Provider | Status |
|---|---|
| Sarvam `saaras:v4` batch (`codemix`, diarization) | **UNVERIFIED**: no `SARVAM_API_KEY`. The adapter's parameters, literals and output types were checked against the installed `sarvamai` 0.1.37 SDK (`tests/test_providers.py`). That check found and fixed a missing `with_timestamps=True` (the SDK defaults to `False`). |
| Local `faster-whisper-small` (fallback, no key) | **Verified mechanically** on a synthetic macOS text-to-speech clip, through the real UI upload (2026-10-23). |

The synthetic clip (`scripts/make_tts_sample.sh`) is 24.5 s long and has 6 lines in
Indian-English, Hindi (Devanagari) and Kannada (Kannada script) voices. The reference is
the exact text given to the TTS.

| Whisper setting | WER | Observation |
|---|---|---|
| default (one language for the whole file) | 0.340 | Hindi line **translated** to English; Kannada "ಸರಿ, ನಾನು ನಾಳೆ… ಶುರು ಮಾಡ್ತೀನಿ" → "Sorry, I don't start the release notes" (**meaning inverted**) |
| per-segment language detection (now the default) | 0.245 | Hindi in Devanagari with errors; Kannada written **phonetically in Devanagari**; English lines near-perfect |

- **No diarization:** every segment is SPEAKER_00.
- **Speed:** 24.5 s of audio transcribed in 13.9 s on CPU.
- **Scope:** this is synthetic TTS speech. It is not the WER of real meetings, which is
  **NOT MEASURED**.
