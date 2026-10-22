# Known limitations

Ordered by how much they matter for the PS 5.3 evaluation.

## Not done or not verified

1. **No real meetings yet.** The official evaluation needs ≥3 consented recordings, ≥1
   code-mixed. None were provided, so there is no WER, real-data action
   precision/recall, speaker attribution score or human summary rating. The tooling is
   ready: `evaluation/real_eval.py`, plus the instructions in `docs/evaluation.md`.
2. **Sarvam STT is unverified.** The adapter follows the documented batch SDK flow, but
   no `SARVAM_API_KEY` was available, so no recording has been transcribed. Code-mixed
   *speech* is therefore not demonstrated. Code-mixed *text* interpretation is: fixture
   T06 and synthetic demo meeting 3.
3. **Gemini is unverified.** No `GEMINI_API_KEY`. All live results come from local
   Ollama models (qwen3:8b, llama3.1:8b) on a CPU. Quality and latency with
   `gemini-3.8-flash` are unknown.
4. **No outbound channels.** No SMTP server was configured, so no email was ever sent.
   No Google/Outlook calendar or chat integration exists; calendar is an in-app view
   plus `.ics` download.

## Model-quality issues observed in live runs (qwen3:8b, synthetic transcripts)

- **Missed completion report.** "The refund API is done and merged" became a
  re-proposal, not `REPORT_COMPLETE`. The engine prevented a duplicate by asking
  "existing TASK-1 or new?", but the organiser had to mark the task done by hand.
- **Minutes list assignments as decisions,** and a stated reason ("to avoid a two-week
  delay") was not put in `rationale`. This happened despite the prompt explicitly
  forbidding both. The UI says "no reason was extracted" rather than claiming none was
  given.
- **Garbled owner.** In one restatement the owner came back as "Pri, Priya". A
  deterministic guard now keeps the earlier clear owner.
- **Dependency recall.** With the event format, llama3.1:8b dropped two dependent tasks
  that direct extraction found (T05, T06). Rule-based cues and prompt v2 mitigate this,
  but cannot recover items the model never proposed. The review lists transcript lines
  that produced nothing so the organiser can check them.
- **Speed.** About 90 s per model call on an Intel i9 CPU, so a short meeting takes about
  3 minutes to analyse. Use pre-processed meetings for a live demo.

## Engine limitations

- **Title matching is lexical** (content tokens, simple stemming, a small synonym list).
  Paraphrases with no shared words ("auth work" vs "login implementation") will not
  match an existing task. The organiser then sees a new task instead of a patch, never a
  silent wrong update.
- **The rule-based dependency cues are English plus a few romanised Kannada/Hindi
  phrases.** They only link items that both exist and decline to guess on ties.
- **Date resolution** covers common English and romanised Hindi/Kannada expressions
  (weekdays, today/tomorrow, *naale*, *kal*, explicit dates, "end of week/month", "in N
  days"). Native-script date words are not parsed. "Next Friday", "next week" and
  same-weekday references are flagged as ambiguous rather than resolved.
- **Synthetic evaluation scale.** The 12 fixtures are small. Post-hoc rule changes were
  made after seeing results on those same fixtures, so the post-hoc numbers are
  optimistic. The pre-registered numbers are the headline.
- **Timestamps are segment-level,** as Sarvam provides them. Evidence links point to a
  segment, not a word.

## Product limitations

- Single organiser, shared bearer token. No accounts, roles or multi-tenancy.
- No encryption at rest and no retention policy (see `docs/privacy.md`).
- Reminders fire only while the backend runs. One reminder default (09:00 local the day
  before the due date), plus manual reminders.
- Re-running analysis on a meeting replaces its unapproved proposals. Meetings whose
  changes were approved cannot be re-uploaded (create a new meeting instead).
- One background worker: meetings are processed one at a time.
- Transcript corrections do not automatically re-run interpretation. Use "Re-run
  analysis".
