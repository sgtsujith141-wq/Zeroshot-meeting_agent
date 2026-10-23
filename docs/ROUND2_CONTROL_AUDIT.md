# Round 2 control audit

Every interactive control of the web app, what it claims, what it calls, and how it was
verified. "Verified" means a Playwright test clicked it in a real browser against a real
backend on a disposable copy of the data, and (where it writes) the test then read the
server's state back through the API. A control is PASS only on that basis; a click handler
existing is not enough.

- **Environment:** macOS laptop, headless Chromium (Playwright build), FastAPI sandbox per test
  (`frontend/e2e/support/sandbox.ts`), demo data from `demo/workspace.sql`.
- **Status key:** PASS (executed and checked), BLOCKED (an external dependency is missing),
  NOT IMPLEMENTED.
- **Columns:** *Dup/fail* = duplicate clicks and server failure; *Kbd/phone* = keyboard and
  390 px phone width. "Global" means covered by the suite-wide checks: every test fails on a
  page error, a console error or an undeclared failing API call; `a11y.spec.ts` runs axe
  (WCAG 2.1 A/AA) on every route in both themes; `screens.spec.ts` checks every route at 1440,
  1024 and 390 px for horizontal overflow and controls outside the viewport.
- **Spec files** (`frontend/e2e/flows/`): shell, links, meetings, approvals, questions,
  tasks-ask-followups (taf), final-ui, live-audio, mic-denied, slow (live model), a11y.

## Sign-in, session, intro, navigation

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C01 | Organiser token + Sign in | Disabled when empty; wrong token refused and not kept | `GET /api/meetings` | token absent from storage after 401 | 401 message shown | Enter submits | shell | PASS |
| C02 | Signed-out notice | Says why the session ended | 401 → sign-in | — | rotated token | — | shell | PASS |
| C03 | Deep link signed out | Sign-in; no data requested | none | no API call made | — | — | shell | PASS |
| C04 | Protected API without token | 401 on every route | all | 401 | — | — | shell, backend | PASS |
| C05 | Presentation intro | First load of a session and `?present=1` only; a refresh does not replay it | none | sessionStorage flag | — | Space/→/←/Esc | final-ui | PASS |
| C06 | Skip intro / Esc / Enter workspace | Leave at once; drops `?present` | none | URL | — | keyboard | final-ui | PASS |
| C07 | Intro, reduced motion | Static linework, lines readable | none | — | — | — | final-ui, a11y | PASS |
| C08 | Brand link | Overview | route | — | — | — | links | PASS |
| C09 | Sidebar: six destinations | Open and mark current | routes | — | — | phone menu | shell | PASS |
| C10 | Approvals count | Equals waiting change sets | `/api/changesets` | count = API | — | — | shell | PASS |
| C11 | More menu: Diagnostics, theme, Sign out | Each acts; Esc closes, focus returns | — | theme persists; token cleared | — | arrows, Esc | shell, links | PASS |
| C12 | Phone menu sheet | Opens; each item closes it | — | — | — | 390 px | shell, links | PASS |
| C13 | Toast Dismiss | Removes toast | — | — | — | — | shell | PASS |
| C14 | Try again after a failed load | Recovers when the server answers | retry | — | 500 then 200 | — | shell | PASS |
| C15 | Old addresses, unknown routes | Redirect | redirects | — | — | — | shell | PASS |

## Overview and Meetings

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C20 | Record or upload a meeting | Opens New meeting | route | — | — | — | meetings | PASS |
| C21 | Meetings awaiting review rows | Open the approval or the meeting | routes | row count = API | — | — | meetings, final-ui | PASS |
| C22 | Upcoming tasks rows (blocked inline) | Open the task drawer | `?task=` | blocked text = prerequisites | — | — | meetings | PASS |
| C23 | Recently processed meetings rows | Open the meeting | route | count = API | — | — | meetings | PASS |
| C24 | Empty state: Record / Upload a transcript / Try a synthetic sample | Open New meeting in that mode; the sample is attached and labelled SYNTHETIC | route | nothing created until submitted | — | — | shell, links (empty DB) | PASS |
| C25 | Meetings search and status filter | Narrow the list | client | counts = API | — | — | meetings | PASS |
| C26 | Meeting row | Opens the meeting | route | — | — | — | meetings | PASS |

## New meeting, recording, upload

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C30 | Record audio / Upload recording / Upload transcript | Switch input mode | — | — | — | radio group | live-audio, meetings | PASS |
| C31 | Record | Asks for the microphone only now; meter shows measured level; elapsed time | getUserMedia, MediaRecorder | recorder state = recording only after the browser starts | denied → explained | — | live-audio (Chromium capture device, speech WAV) | PASS |
| C32 | Record, microphone refused | "Microphone access was denied…", upload offered, never "Recording" | — | — | NotAllowedError | — | mic-denied | PASS |
| C33 | Record, browser cannot record here | Says so, upload offered | — | — | NotSupportedError | — | mic-denied | PASS |
| C34 | Stop | Stops, releases the microphone, keeps the take | — | blob created | — | — | live-audio | PASS |
| C35 | Play / Pause | Plays the take from the browser | — | — | — | — | live-audio | PASS |
| C36 | Re-record | Discards the take | — | state back to idle; Transcribe disabled | — | — | mic-denied (synthetic oscillator stream) | PASS |
| C37 | Physical microphone on the demo laptop, a person speaking | Real voice recorded and transcribed | — | — | — | — | operator preflight | **BLOCKED**: macOS denies microphone access to the developer tools; needs the presenter (docs/LIVE_AUDIO_DEMO.md §2) |
| C38 | Choose a file / drop zone / Remove file | Attach, drop, remove | — | — | wrong kind refused | — | meetings | PASS |
| C39 | Use the synthetic demo transcript | Attaches the bundled synthetic file, title and date | — | uploaded file = bundled file | — | — | final-ui | PASS |
| C40 | More options → time zone | Sent to the server | `POST /api/meetings` | request body | — | — | meetings | PASS |
| C41 | Consent checkbox | Required for every mode | — | — | — | — | meetings, live-audio | PASS |
| C42 | Transcribe recording | Creates the meeting, uploads `transcribe_only` | upload | status `transcribed`, no change set, provider whisper-local | button disabled while busy | — | live-audio, backend | PASS |
| C43 | Analyze meeting (upload modes) | Upload and full processing | upload | meeting + segments | refused file → meeting deleted, "Nothing was saved" | — | meetings, final-ui | PASS |
| C44 | Video with sound | Stored as video; audio track transcribed | upload | `source_type=video` | video without sound → 422 | — | backend `test_transcribe_first.py` | PASS |

## Meeting page: processing, transcript, results

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C50 | Five-stage timeline | Real status and log times; no percentages | `GET /api/meetings/{id}` (polled) | — | — | phone layout | final-ui | PASS |
| C51 | Transcript shown during and after transcription | Words visible before analysis; read-only while running | same | segments = API | — | — | live-audio, final-ui | PASS |
| C52 | Correct (a line) → Save correction | Stored as a new revision | `PATCH /segments/{key}` | text and revision = API | Save disabled when unchanged | — | live-audio | PASS |
| C53 | Download transcript | .txt of the stored transcript | client | file downloaded | — | — | final-ui | PASS |
| C54 | Analyze meeting (after transcription) | Interpretation + minutes, no re-transcription | `POST /process` | status → ready_for_review | busy disables | — | backend, slow | PASS |
| C55 | Retry analysis (after a model failure) | Same, transcript kept | `POST /process` | transcript intact; not re-transcribed | model down → "Transcription complete; AI analysis unavailable." | — | final-ui, backend | PASS |
| C56 | Try transcription again | Re-runs speech-to-text only | `POST /process` | failure keeps the recording; retry → transcribed | provider error shown | — | backend `test_transcribe_first.py` | PASS |
| C57 | Open a sample processed earlier | Opens a separate, labelled synthetic meeting | route | — | — | — | final-ui | PASS |
| C58 | Evidence references (speaker + time) | Open the transcript drawer at the line | client | flash on segment | — | — | final-ui, meetings, links | PASS |
| C59 | Transcript (header) drawer, audio play-from-time | Opens; plays from segment | media URL | currentTime | codec skip on headless | Esc | meetings | PASS |
| C60 | Review and approve tasks / View approved tasks | Opens the approval | route | — | — | — | final-ui, links | PASS |
| C61 | Download meeting report | PDF of stored records | `GET /report.pdf?download=1` | file starts `%PDF-` | 409 without transcript | — | final-ui, backend | PASS |
| C62 | Preview report | Opens the PDF in a new tab | `GET /report.pdf` | popup opens the PDF (blob URL) | — | — | final-ui | PASS |
| C63 | Speakers tab: Confirm / Rename | Identity stored; proposals re-checked without the model | `PUT /participants/{label}` | participant = API | — | arrows switch tabs | meetings | PASS |
| C64 | Share summary: Prepare / Copy and mark approved / Approve and send | Prepare; copy then approve only if the copy succeeded; email reported NOT sent without SMTP | `POST /summary`, `/summaries/{id}/approve` | state = API | clipboard refused → no approval (regression test) | — | meetings | PASS (real email send **BLOCKED**: no SMTP) |
| C65 | Technical details: Show/Hide events, segment links | Toggle; open transcript | — | — | — | — | meetings, links | PASS |
| C66 | More → Re-run analysis | Confirm dialog; refused for approved meetings | `POST /process` | 409 reason shown | Cancel | Esc | meetings | PASS |
| C67 | More → Delete meeting | Confirm; refused when approved tasks depend on it | `DELETE /meetings/{id}` | 404 after delete | Keep it | Esc | meetings | PASS |

## Approvals and questions

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C70 | Waiting / All tabs, rows | Filter, open | `/api/changesets` | counts = API | — | arrows | approvals | PASS |
| C71 | Change rows (before → after) | Same rules as approval | `GET /changeset` | applied result = table | — | phone | approvals, final-ui | PASS |
| C72 | Row drawer: Edit (owner, due, priority), Cancel, Exclude / Include, Remove dependency | Stored on the proposal | `PATCH /changesets/{id}` | organizer_edits = API | — | Esc | approvals | PASS |
| C73 | Every question type's answers (same task, owner, speaker mapping, deadline, cancellation, unverified link, assistant-addressed, missing prerequisite) | Stored with their effect | `PATCH`, `PUT /participants` | answer = API | other choices disabled while saving; one request | — | approvals, questions | PASS |
| C74 | Change answer | Undoes the answer | `PATCH` | answer null | — | — | approvals | PASS |
| C75 | Orphaned-answer actions | Apply the earlier answer or keep the proposal | `PATCH` | item = API | blocks approval until decided | — | approvals, links | PASS |
| C76 | Re-check against the current board | Recomputes without the model | `POST /changeset/recompute` | ledger snapshot = board | stale → 409 then recover | — | approvals | PASS |
| C77 | Approve | Applies exactly what is shown; pinned to the reviewed hash | `POST /changesets/{id}/approve` | tasks = API | double click → one approval; stale → 409 | — | approvals | PASS |
| C78 | Reject all | Confirm with reason; read-only after | `POST /reject` | state REJECTED | Esc / Keep reviewing cancel | — | approvals | PASS |
| C79 | Decisions to record checkboxes | Stored | `PATCH` | include = API | — | — | approvals | PASS |

## Tasks, Ask AI, Follow-ups, Diagnostics

| ID | Control | Claims | API | State verified | Dup / fail | Kbd / phone | Test | Status |
|---|---|---|---|---|---|---|---|---|
| C80 | Tasks list / Board, filters, Clear | Filter; view in the address | `/api/tasks` | counts = API | — | — | taf | PASS |
| C81 | Task drawer: Move to (status) | New revision stored | `PATCH /tasks/{code}` | revision = API | changed elsewhere → refused and explained | — | taf | PASS |
| C82 | Blocked prerequisite | Start/finish disabled; server refuses too | `PATCH` | 409 | — | — | taf | PASS |
| C83 | Download .ics, evidence/origin links | Valid calendar entry; open meeting | `/tasks/{code}/event.ics` | file content | — | — | taf | PASS |
| C84 | Ask: question, Enter, Ask button | Fast path from task records or grounded answer | `POST /memory/query` | mode = task_records for task questions | request failed → Try again | Enter sends | taf, final-ui | PASS |
| C85 | Ask: suggestions, "Which task do you mean?" buttons | Ask again for that task | same | — | — | — | final-ui | PASS |
| C86 | Ask: passages while the model writes | Real retrieval shown before the answer | `GET /memory/search` | — | model down → "Model unavailable" | — | slow | PASS |
| C87 | Ask: source and task links | Open the meeting line or task | routes | — | — | — | taf, links | PASS |
| C88 | Follow-ups tabs, agenda download, links | Addressable tabs; Markdown agenda | `/api/agenda`, `/agenda.md` | file content | — | — | taf, links | PASS |
| C89 | Calendar export | Every approved due date | `/api/calendar.ics` | file content | — | — | taf | PASS |
| C90 | Reminders: New reminder, Approve, Cancel | Stored states; email without recipients refused | `/api/reminders…` | state = API | — | Esc | taf | PASS |
| C91 | Reminder delivery | In-app delivered; email without SMTP "not sent" | worker | state = API | — | — | taf, backend | PASS (email send **BLOCKED**: no SMTP) |
| C92 | Diagnostics: Run live test | Real provider check | `/api/diagnostics/llm-test` | result shown | — | — | slow | PASS |

## Not covered by an automated click

C37 needs the presenter. C56 is tested through the API it calls (a browser click is not automated). Multi-speaker diarization is **BLOCKED**
(no Sarvam key): the UI states that speaker separation is unavailable and never invents
speaker IDs.
