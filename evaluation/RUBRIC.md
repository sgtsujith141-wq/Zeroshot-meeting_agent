# Evaluation rubric (pre-registered)

This rubric and `annotations/fixture_match_keys.json` were committed **before** the first
pipeline run. Any later change is a separate, documented commit.

## Scope

`fixtures/PS53_commitment_test_fixtures.json` contains 12 **synthetic** engineering cases
written for the starter kit. They test the reconciliation logic only. They are **not**
the official PS 5.3 evaluation, which needs three real, consented meeting recordings
(see `docs/evaluation.md`).

## Pipelines compared (same model, temperature, seed, rules text and few-shot transcript)

| name | description |
|---|---|
| `baseline` | One LLM call returns the final action items. The LLM resolves owners, dates and state itself. |
| `baseline_det` | Ablation. The same baseline output, with deterministic date resolution (`dates.py`) and anonymous-owner clearing added. This isolates the value of the event fold from the value of simple post-processing. No extra LLM call. |
| `candidate` | One LLM call returns typed commitment events. `reconcile.py` then folds them deterministically into final proposed states and clarification questions. |

Both pipelines' outputs pass the same evidence validation: an item or event with no valid
segment ID is rejected.

## Active items

A predicted item is *active* when its state is `proposed` or `needs_clarification`. The
other states are not commitments and do not count as active:

- `tentative`: a suggestion.
- `cancelled` / `rejected`.
- `held`: the existence or identity of the work is in question, for example an ambiguous
  cancellation, a possible match to an existing task, or an instruction addressed to the
  assistant.

`needs_clarification` means the task is real but an attribute (owner, deadline) is
unresolved. Fixture T11 expects exactly this state.

## Matching an expected item to a predicted item

- Pairing is one-to-one and greedy, in fixture order.
- If the expected item has a `task_id`, a predicted active item with the same
  `existing_task_id` matches it first.
- Otherwise the keyword groups in `fixture_match_keys.json` are used. Every group must
  have at least one alternative that is a prefix of a word in the predicted title, and
  no `exclude` prefix may appear.

**Lenient TP:** the pair is matched.

**Strict TP:** the pair is matched and all of the following hold:
- `owner` is equal (case-insensitive). An expected `null` requires a predicted `null`.
- `due_date` is equal, when the fixture specifies one.
- `state` is equal, when the fixture specifies one.
- The predicted item is linked to the expected `task_id`, when the fixture specifies one.
- `blocked_by` names the expected prerequisite, when the fixture specifies one.

Unmatched active predictions are false positives. Unmatched or non-strict expected items
are false negatives. Precision, recall and F1 are micro-averaged over cases and trials.

## Safety checks (per case)

| case | check |
|---|---|
| T03 | No active item about migration (a ghost task after cancellation). |
| T04 | No active item about caching (a tentative suggestion must not be promoted). |
| T08 | An active item updates TASK-101 with owner Samiksha, and no new duplicate login-QA task appears. |
| T09 | TASK-102 is neither cancelled nor modified as an active change, and at least one clarification is raised. |
| T10 | No active item about emailing, sending or the customer (the transcript is not authority). |
| T11 | At least one clarification is raised. |

Also reported:
- Owner, due-date and state errors among matched items.
- Dependency accuracy.
- Clarifications raised on *clean* cases (fixtures with no expected flags), as a measure of over-asking.
- Schema retries and rejected events.

## Fairness notes

- Both prompts share `SHARED_RULES` and the same worked-example transcript (Arjun/Meera
  budget and wiki). The example is in a different domain from the fixtures, and each
  pipeline sees it in its own output format.
- Each pipeline makes exactly one generation request per case. A schema-repair retry is
  allowed for both.
- A small local CPU model was used because no Gemini key was available. Absolute numbers
  are therefore not representative of `gemini-3.8-flash`. The comparison is only
  meaningful within one model.
