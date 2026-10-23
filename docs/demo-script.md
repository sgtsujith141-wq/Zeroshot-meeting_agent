# Demo script (5–7 minutes)

Use **pre-processed meetings**. Local model calls take about 90 s each on a CPU, so
process the meetings before the session. Every claim below matches something that runs.
Say "synthetic" whenever showing the demo transcripts. If real recordings have been
processed by then, show them instead and say so.

**Setup before going on stage:**
- Backend running and the UI open.
- Meetings 1 and 2 processed and approved.
- Meeting 3 processed, not approved.
- The audio meeting processed: a real recording if available, else the synthetic TTS
  check (meeting 4).
- Diagnostics page loaded. It shows which LLM and STT are live.
- Never run a first-ever provider call live on stage.

---

## 0:00 Problem (30 s)

> "After a meeting, the hard part isn't the summary. It's knowing what was actually
> agreed *now*. People propose, correct themselves, reassign, cancel half a plan, and
> next week someone changes the deadline. Most tools either miss those changes or
> create a second copy of the same task."

## 0:30 Landscape and our narrow claim (30 s)

> "Otter, Fireflies and Fellow already transcribe and summarise. We don't claim to be the
> only ones extracting actions. Our narrow focus is *commitment state*: we keep one
> correct version of each task across meetings, and we ask instead of guessing when
> something is ambiguous."

## 1:00 Real audio and speakers (60 s)

**Preferred: one of the team's real, consented recordings** (pre-processed before the talk).
- Open it and point out the transcript with segment timestamps.
- Say which provider transcribed it, as shown on the page ("Transcribed by sarvam" or
  "whisper-local").
- Rename a speaker. Proposals re-check instantly, without another model call.

**Fallback, if no real recording has been processed: "Audio upload check (synthetic
TTS)".**
- Say: "This is a text-to-speech clip we generated, not a real meeting."
- Show the upload went through the real pipeline: FFmpeg, then local Whisper, then
  interpretation.
- State the limits plainly:
  - no speaker separation, so everything is SPEAKER_00;
  - the Kannada line came out phonetically in Devanagari;
  - Sarvam, which separates speakers and handles code-mix, needs a key we have not
    used yet.
- For speaker correction, use meeting 1 instead: SPEAKER_03 → Meera.

Then:
- Show minutes and decisions with quotes, and "How this meeting was interpreted": the
  model only emits typed events, each citing a segment.
- Consent: show the attestation on *Add a meeting* and the data-flow notice.

## 2:00 The review screen (75 s): Review changes → meeting 1

- Point to the ranked question: **"Who is SPEAKER_03?"**
  - SPEAKER_03 said "I can update the release notes by Friday".
  - We never treat a diarization label as a person.
  - Map it to *Meera*: the proposal re-checks instantly, without calling the model.
- Point to *Run regression tests*:
  - it waits for the refund API, from "once the refund API is ready";
  - "How this was worked out" shows the numbered steps.
- *Look into the flaky login test* stays a **suggestion**, because "maybe someone
  should…" is not a commitment.
- Approve:
  - "Approval is pinned to the exact version I reviewed. The server refuses a stale or
    unanswered proposal, even if the button were hacked on."
  - If another meeting was approved after this proposal was checked, the review shows
    *The task board changed* and offers *Re-check against the current board* (no model
    call, answers kept) before Approve is enabled again.

## 3:15 Next meeting changes existing work (75 s): meeting 2 review (already applied)

- **Change to existing task TASK-2:**
  - owner ~~Priya~~ → **Samiksha**, due ~~none~~ → **Mon 26 Oct**;
  - quotes from the follow-up meeting.
  - "Not a new task: a patch to the same one."
- **"Cancel the old release notes plan"** was *held*. The system asked whether the
  whole task or only the old plan was cancelled, and we kept the task.
- **Honest failure:** "The refund API is done and merged" was not recognised as a
  completion by the 8B local model. The engine refused to create a duplicate and asked
  "is this TASK-1?". We marked it done on the board ourselves.
- Task board → TASK-2 drawer:
  - evidence from both meetings;
  - revision 1 → 2 history;
  - no longer blocked once TASK-1 is done.

## 4:30 Follow-up and memory (60 s)

- *Calendar & reminders*:
  - due dates, the `.ics` export ("an export, not a calendar sync");
  - an in-app reminder that actually fired from the background worker.
- *Next agenda*: overdue, blocked, due-soon tasks and open questions, each linked to its
  source meeting.
- *Ask past meetings*: "Who owns the regression tests and when are they due?" The
  answer cites the transcript lines and shows the *current approved state* separately
  (Samiksha, 26 Oct). That differs from what was first said (Priya).
- Meeting 3 (synthetic Kannada/Hindi-English text):
  - *"naale finish maadthini"* resolves to tomorrow;
  - *"Wednesday olage"* resolves to Wednesday.
  - Code-mixed speech is still to be verified with Sarvam.

## 5:30 Honest evaluation (60 s): Diagnostics

- Same model, same inputs, pre-registered rubric, 12 synthetic cases:
  - direct extraction strict F1 **0.35** vs our engine **0.82** on qwen3:8b;
  - **0.72 vs 0.90** on llama3.1:8b;
  - safety checks (no ghost tasks, no silent cancellation, no fake owner, no duplicate):
    **8/8 vs 4–5/8**, and 7/8 in one later post-hoc run, which we also show.
- "About half the qwen gain is just deterministic date handling. We measured that with
  an ablation."
- "Where we were worse: dependency recall on llama3.1. We show that rather than hide it."
- "On a fresh holdout written after we froze the code: safety 10/10 vs 5/10, whole cases
  correct 7/10 vs 3/10. But on item extraction alone, the baseline with our date rules was
  better (strict F1 0.75 vs 0.625). Our claim is safer state, not better extraction."
- "These are synthetic engineering tests. The official three-real-meeting evaluation
  (WER, precision/recall vs human labels, human summary ratings) is our next step; the
  tooling is ready."

## 6:30 Limitations and close (30 s)

- Not yet verified with Gemini or Sarvam keys.
- Single-organiser local mode, no encryption at rest, no email sent (no SMTP).

> "The model describes; rules decide; a human approves. That's why the board stays
> correct across meetings."
