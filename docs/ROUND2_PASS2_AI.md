# Round 2, pass 2: AI accuracy and content quality

Goal: credible meeting output from the real model, and an analysis fast enough for a live demo.
Every number here comes from a live run of Ollama `qwen3:8b` on the demo laptop (Intel Core
i9-9980HK, CPU only) or from replaying those recorded responses through the current rules.
Gemini and Sarvam were **not** compared: no keys are configured (`GEMINI_API_KEY`,
`SARVAM_API_KEY` not set), so there is no verified faster provider.

## 1. Latency: where the time goes, and the fix

Recorded token counts (`llmrun.usage`) for a 4-line recording:

| Call | Prompt tokens | Output tokens | Generation | Total |
|---|---|---|---|---|
| Interpretation (events) | 1,334 | 142 | 28.1 s | 74.6 s |
| Minutes | 473 | 271 | 49.9 s | 64.0 s |

Thinking is already off (`think: false`), output is short and structured, and the model stays
loaded (`keep_alive: 30m`): the time is the model's speed on this CPU (about 5 tokens/s
generating, about 30 tokens/s reading the prompt). Shorter prompts would trade away the rules
and the worked example that the reconciliation depends on.

The two calls are independent: the minutes call needs only the transcript. Measured on the
same meeting, same model:

| | Interpretation | Minutes | Wall time |
|---|---|---|---|
| One after the other | 69.4 s | 64.6 s | **134.0 s** |
| At the same time | 75.2 s | 48.4 s | **75.2 s** |

Same outputs (3 events, 3 decisions). The pipeline now sends the minutes request when the
interpretation starts (`processing.start_minutes_call`; `LLM_CONCURRENT_MINUTES=0` restores the
old order). End to end through the API on the recorded meeting: **78.6 s** (was 139.2 s), with
the same summary, decision and proposals. Tests: `test_concurrent_minutes.py` (same stored
result as sequential; an interpretation failure with minutes in flight fails cleanly and keeps
the transcript).

A smaller local model was **not** adopted: the installed small models (1–2B) were not evaluated,
and no smaller model is verified to keep the extraction quality below.

## 2. Difficult statements: fresh holdout v3

Eight new synthetic cases, written from the brief's difficult statements with new names and
domains, committed with their match keys **before** any run (`288e7bb`). First and only live
run (`evaluation/results/20261023T083210Z_ollama_qwen3-8b_holdout-v3-first.md`):

| Statement | Case | Baseline | Baseline + date rules | **Engine** |
|---|---|---|---|---|
| "I will finish it tomorrow." | W01 | PASS | PASS | PASS |
| "Someone should check the API rate limits at some point." | W02 | PASS | PASS | PASS (not a task) |
| "Actually, Omar will handle the load testing instead." | W03 | FAIL | FAIL | FAIL (asks whether it is TASK-503; no duplicate, no update until answered) |
| "About the data migration, cancel the old plan." | W04 | FAIL | FAIL | PASS (asks; the task is kept) |
| "The search API is done and merged." | W05 | PASS | PASS | PASS (TASK-505 marked done) |
| "Testing can start after the export endpoint is complete… next Monday." | W06 | FAIL | FAIL | FAIL |
| Hindi-English "kal tak … kar dena / kar dunga" | W07 | FAIL | PASS | PASS |
| Kannada-English "Yaradru … maadi" (someone do…) | W08 | FAIL | FAIL | FAIL |
| **strict F1 / safety checks / cases fully correct** | | 0.333 / 2/7 / 3/8 | 0.667 / 2/7 / 4/8 | **0.545 / 5/7 / 5/8** |

The engine is safer (asks instead of guessing or duplicating) but, as on holdout v2, it is
**not** better on item-level F1 than the baseline with date rules.

### Real defects found, and the fix

1. **Invented owner name** (W06): the model wrote the owner as "R3ha" (the meeting says Rhea).
2. **Requester made owner** (W08): for "someone make a dashboard draft", the model made the chair
   (the speaker) the owner, without any first-person commitment.

Both are owner-identity errors, so the fix is one general rule in the engine's owner path
(`reconcile._grounded`), not a prompt tweak:

- a named owner must be mentioned in the meeting or already be a known person (speaker, mapped
  participant, task owner); otherwise nobody is assigned and the organiser is asked, with the
  closest real name as a hint ("did it mean Rhea?");
- on a proposal, the speaker becomes the owner only when their own words commit them (first
  person in English, Hindi or Kannada: "I'll", "main … kar dunga", "naanu … maadtini").

Regression tests: `tests/test_owner_grounding.py` (garbled name, chair's request, first-person
commitments in three languages, owners named in the meeting or on the board kept).

### Effect, by replaying the recorded model responses (no new model calls)

| Recorded run | strict F1 before → after | safety | fully correct |
|---|---|---|---|
| Starter fixtures (qwen3:8b) | 0.952 → 0.952 | 8/8 → 8/8 | 11/12 → 11/12 |
| Starter fixtures (llama3.1:8b) | 0.857 → 0.857 | 7/8 → 7/8 | 9/12 → 9/12 |
| Holdout v1 | 0.706 → 0.706 | 11/11 → 11/11 | 9/12 → 9/12 |
| Holdout v2 | 0.625 → 0.625 | 10/10 → 10/10 | 7/10 → 7/10 |
| Holdout v3 (**contaminated**: the rule came from its failures) | 0.545 → 0.727 | 5/7 → 6/7 | 5/8 → 6/8 |

No regression on the four runs the rule was not derived from. The v3 improvement is post hoc
and must not be quoted as a held-out result (report:
`evaluation/results/20261023T084151Z_ollama_qwen3-8b_replay_holdout-v3-posthoc-owner-grounding.md`).
A fresh holdout v4 would be needed for an unbiased number. Remaining v3 failures: W03 (the model
proposed a new task instead of naming TASK-503; the engine asks rather than duplicating) and
W06 (the owner is now asked for, and "next Monday" is flagged as ambiguous).

## 3. Meeting memory

Live, on the demo workspace:

| Question | Path | Result | Time |
|---|---|---|---|
| Who owns the regression tests and when are they due? | task records | Samiksha, Mon 26 Oct 2026, cites s3 and s4 | 0.01 s |
| Why do we keep Stripe as the payment provider? | grounded model | "…switching now would delay the release by two weeks", cites s5 | 31.8 s |
| What budget was approved for the marketing campaign? | retrieval | "not found in stored meetings" (no passage matched) | 0.01 s |
| Who is the CEO of the company? | retrieval | "not found in stored meetings" | 0.01 s |

No unsupported answer was produced. The UI labels the paths differently ("Answer from approved
task records", "Answer from the meeting records", "Nothing found in stored meetings").

## 4. Not done in this pass

- No Gemini / Sarvam comparison (no keys).
- No new prompt version: prompt v3 was reverted earlier because it hurt holdout v1, and no prompt
  change was justified by a held-out result in this pass.
- Decision rationales: still often missed by the 8B model when the reason is implicit (known
  limitation, `SUBMISSION_CHECKLIST.md` item 4).
