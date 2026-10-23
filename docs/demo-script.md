# Demo script (5–7 minutes)

For the **live recording** route (record in the browser, transcript in seconds, then analysis
and the PDF report), with its preflight and fallbacks, see [`LIVE_AUDIO_DEMO.md`](LIVE_AUDIO_DEMO.md).

Use **pre-processed meetings**. Local model calls take about 90 s each on a CPU, so
process the meetings before the session. Every claim below matches something that runs.
Say "synthetic" whenever showing the demo transcripts. If real recordings have been
processed by then, show them instead and say so.

## Live walkthrough (the final UI)

This is the route through the app, in order. The talk track below fills in what to say.

1. **Intro.** Open `http://127.0.0.1:8000/?present=1`. Four lines, then *Meeting Actions:
   From conversation to completed work*. Space or → moves on, Esc or *Skip intro* leaves
   at once, and *Enter workspace* opens the app. It only appears at `?present=1`.
2. **Your workspace.** *Needs your review*, *Upcoming tasks* (blocked work says what it
   waits for) and *Recent meetings*. Every row opens its record. Demo meetings carry a
   SYNTHETIC tag.
3. **New meeting.** Choose *Use the synthetic demo transcript* (bundled, no real people),
   tick consent, then *Analyze meeting*. Dragging a file in or choosing one works the same.
4. **Processing.** Four stages follow the server's real status: Preparing meeting,
   Processing transcript, Identifying decisions and tasks, Preparing results. Times are
   measured from the server's log; there are no percentages. With a local model the third
   stage takes a few minutes.
   - If time is short, use *Open a sample processed earlier*. Say it out loud: it is a
     separate synthetic meeting analysed before the talk, not the result of this upload.
5. **Results.** Meeting summary, Key discussions, Decisions made, Action items (task,
   owner, due, priority, dependency) and Questions to clarify. Each speaker-and-time
   reference opens the transcript at that line. Then *Review and approve tasks*.
6. **Approvals.** Each row reads as before → after ("Owner: Priya → Samiksha",
   "Deadline: 26 October → 27 October"). Questions appear only when something is
   unclear; approval stays blocked until they are answered.
7. **Tasks.** The compact list; open a task for its evidence and history.
8. **Ask AI.** Ask "Who owns the regression tests?": answered from the approved task
   board without the model, with its measured time. Then ask a "why" question: the
   matching passages appear while the model writes the answer.
9. **Follow-ups.** Agenda, calendar export and reminders.

**Setup before going on stage:**
- Backend running and the UI open.
- Meetings 1 and 2 processed and approved.
- Meeting 3 processed, not approved.
- The audio meeting processed: a real recording if available, else the synthetic TTS
  check (meeting 4).
- Diagnostics page loaded (More → Diagnostics). It shows which LLM and STT are live.
- Never run a first-ever provider call live on stage.
- Meetings 3 and 4 were proposed before the latest rule changes:
  - Approving meeting 3 as stored is refused with *This proposal changed on the server*.
    *Re-check against the current board* then lists the new TASK-2 deadline and priority.
  - On meeting 4, the first answer re-runs the rules. *What changed after your last
    action* then shows "Finish the login screen" getting owner Kavya, from "Kavya, please
    finish the login screen by friday". SPEAKER_00 stays unmapped.

  Both are expected, and both are good demo moments.

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
- Consent: show the attestation on *Meetings → New meeting* and the data-flow notice.

## 2:00 The approval screen (75 s): Approvals → meeting 1

- Point to the ranked question: **"Who is SPEAKER_03?"**
  - SPEAKER_03 said "I can update the release notes by Friday".
  - We never treat a diarization label as a person.
  - Map it to *Meera*: the proposal re-checks instantly, without calling the model.
- Point to the *Proposed changes* table: each row says what approval will write, with the
  current and proposed values. Open *Run regression tests*:
  - it waits for the refund API, from "once the refund API is ready";
  - the drawer shows the quotes and "How this was worked out" as numbered steps.
- After answering, the notice *What changed after your last action* lists every item the
  answer affected, so nothing changes silently.
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
- Tasks → TASK-2 drawer:
  - evidence from both meetings;
  - revision 1 → 2 history;
  - no longer blocked once TASK-1 is done.

## 4:30 Follow-up and memory (60 s)

- *Follow-ups*:
  - *Agenda*: overdue, blocked, due-soon tasks and open questions, each linked to its
    source meeting;
  - *Calendar*: due dates and the `.ics` export ("an export, not a calendar sync");
  - *Reminders* and *Notifications*: an in-app reminder that actually fired from the
    background worker. Email shows *Not sent* while no SMTP server is configured.
- *Ask AI*: "Who owns the regression tests and when are they due?" The
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
