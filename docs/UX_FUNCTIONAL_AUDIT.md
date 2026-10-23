# UX and functional audit

This audit covers every screen and interactive control of the organiser web app. It has two
parts:

- **Part A** audits the UI as it was at commit `10deb16`, before the UX rebuild.
- **Part B** covers the rebuilt UI. It is filled in after the rebuild, with its own test run.

## How the audit was run

- **Real app, real browser.** Every result below comes from Playwright driving a real
  Chromium against a real FastAPI backend: `uvicorn app.main:app` serving `frontend/dist`.
- **Disposable copies only.** Each destructive test gets its own sandbox
  (`frontend/e2e/support/sandbox.ts`):
  - a fresh copy of the demo database, or an empty one;
  - a random organiser token;
  - a free port.

  The demo database is only read, through SQLite's online backup API. The demo server on
  port 8000 and its data were never written to.
- **Backend-confirmed results.** A click does not count as working because something
  happened on screen. Every write is checked against the API (`/api/...`) after the browser
  action.
- **Error checks on every test.** The shared fixture (`frontend/e2e/support/fixtures.ts`)
  fails any test that sees:
  - an uncaught exception;
  - a console error;
  - an API response ≥ 400 that the test did not declare as expected.
- **Live model where needed.** Upload, processing, grounded answers and the Diagnostics live
  test call the local model (Ollama `qwen3:8b`). Those four tests are in `slow.spec.ts` and
  take about 4 minutes.
- **Baseline tests.** The specs that audited `10deb16` are `frontend/e2e/baseline/*.spec.ts`.
  They are kept in the commit that adds this document. They target the old UI and are
  removed in the rebuild commit, so check out that commit to re-run them.

Result values: **PASS**, **FAIL**, **BLOCKED** (cannot be exercised, with the reason) and
**NOT IMPLEMENTED** (the expected control does not exist).

Severity:

- **P0**: wrong task ownership, an action the organiser did not authorise, data corruption,
  or the review showing something other than what approval applies.
- **P1**: a workflow that can strand or mislead the organiser.
- **P2**: friction or missing feedback.

## Part A: baseline audit of `10deb16`

### Routes

| Route | Screen |
|---|---|
| `/` (signed out) | Sign in |
| `/` | Overview |
| `/review` | Review changes (list) |
| `/review/:meetingId` | Review of one meeting's proposed changes |
| `/meetings/new` | Add a meeting |
| `/meetings/:id` | Meeting page |
| `/tasks` | Task board |
| `/follow-up` | Calendar and reminders |
| `/agenda` | Next meeting agenda |
| `/memory` | Ask past meetings |
| `/diagnostics` | Diagnostics |
| `*` | Redirects to Overview |

That is 11 routes plus the catch-all.

### Test runs

These counts are from a single full run of the fast baseline: 87 tests, 262 s. The four
live-model tests ran separately (4.1 min).

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `baseline/shell.spec.ts` | 20 | 18 | 2 (S06, O03) |
| `baseline/review.spec.ts` | 24 | 21 | 3 (V26b, V29, V30) |
| `baseline/meeting-tasks.spec.ts` | 21 | 18 | 3 (N03, N04, T05) |
| `baseline/followup-ask.spec.ts` | 10 | 10 | 0 |
| `baseline/extra.spec.ts` | 12 | 11 | 1 (V32) |
| `baseline/slow.spec.ts` (live model) | 4 | 4 | 0 |
| **Total** | **91** | **82** | **9** |

One test run is not the same as one control. Several tests cover more than one control, and
the inventory below counts controls.

### Control inventory and results

The Test column gives the baseline test ID (for example `V15` is in `review.spec.ts`).

#### Sign in and session

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C01 | Organiser token input | Masked input; keeps the typed token | As expected | none | PASS | — | S01 |
| C02 | Sign in button | Disabled when empty; a valid token opens the workspace; a wrong token is refused and not stored | As expected | `GET /api/meetings` 200 / 401 | PASS | — | S01–S03 |
| C03 | Sign-in error message | Shows the server's reason | "invalid organiser token" shown | 401 detail | PASS | — | S02 |
| C04 | Deep link while signed out | Sign-in shown; no protected request made | As expected | no `/api` calls | PASS | — | S04 |
| C05 | API without a token | 401 on every protected endpoint | 401 on meetings, tasks, changesets, reminders | 401 | PASS | — | S05 |
| C06 | Expired or rotated token | Back to sign-in **with the reason** | Returns to sign-in silently; no explanation | 401 then sign-in | **FAIL** (P2) | Show "your session ended" on sign-in | S06 |

#### Shell and navigation

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C07 | Brand link | Opens Overview | As expected | route | PASS | — | S08 |
| C08 | Sidebar "New meeting" | Opens the upload form | As expected | route | PASS | Duplicate of a page action; remove from the sidebar | S08 |
| C09–C15 | Seven sidebar links (Overview, Review changes, Task board, Calendar & reminders, Next agenda, Ask past meetings, Diagnostics) | Each opens its page | As expected | routes | PASS | Restructure into the new IA; Diagnostics becomes secondary | S07 |
| C16 | Sidebar count badges | Equal the API's pending reviews and open tasks | Equal (2 pending, 3 open) | `/api/changesets`, `/api/tasks` | PASS | — | S07 |
| C17 | Light/Dark toggle | Switches and persists after reload | As expected | `localStorage ps53.theme` | PASS | Move to the secondary menu | S09 |
| C18 | Sign out | Clears the token; shows sign-in | As expected | `sessionStorage` cleared | PASS | — | S10 |
| C19 | Unknown route | Lands on Overview | As expected | redirect | PASS | — | S11 |
| C20 | Phone menu button | Opens and closes the menu | As expected | — | PASS | — | S12 |
| C21 | Phone "+" (New meeting) | Opens the upload form | As expected | route | PASS | Remove (duplicate) | S12 |
| C22 | Phone menu after choosing a page | Menu closes | As expected | — | PASS | — | S12 |
| C23 | Toast "Dismiss" | Removes the toast | As expected | — | PASS | — | S13 |

#### Overview

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C24 | "Review N pending" | Opens the review list | As expected | route | PASS | — | O02 |
| C25 | Header "New meeting" | Opens the upload form | As expected | route | PASS | — | O07 |
| C26 | Needs-your-review rows | One per pending change set; each opens its review | Match the API; open the right review | `/api/changesets` | PASS | — | O01 |
| C27 | "All reviews" link | Opens the review list | As expected | route | PASS | — | O08 |
| C28 | Upcoming-deadline rows | Open the task | Rows are not clickable | none | **NOT IMPLEMENTED** (P2) | Rows open the task drawer | O03 |
| C29 | "Task board" panel link | Opens the board | As expected | route | PASS | — | O08 |
| C30 | Blocked-task rows | Open the task | Not clickable; no blocked task in the data | none | **NOT IMPLEMENTED** (P2) | Rows open the task drawer | — |
| C31 | Meeting-table title link | Opens the meeting | As expected | route | PASS | — | O05 |
| C32 | Meeting-table review chip | Opens the review | As expected | route | PASS | — | O06 |
| C33 | Meeting-table arrow | Opens the meeting | As expected | route | PASS | — | O05 |
| C34 | Empty database: "Add your first meeting" | Empty state with a way forward | As expected | `/api/meetings` → `[]` | PASS | — | E01 |

#### Review changes (list)

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C35 | State groups and rows | Grouped by state with counts; rows open the review | As expected | `/api/changesets` | PASS | — | R01 |
| C36 | Empty list: "Add a meeting" | Opens the upload form | As expected | route | PASS | — | R02 |
| C37 | Empty states on every page (empty database) | Sensible empty states, no errors | As expected | — | PASS | — | E02 |

#### Review of one meeting (`/review/:id`)

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C38 | Breadcrumb "Review changes" | Opens the list | As expected | route | PASS | — | V34 |
| C39 | "Open meeting" | Opens the meeting | As expected | route | PASS | — | V34 |
| C40 | "Transcript" (below 1280 px) | Opens the transcript drawer; Esc closes it | As expected | — | PASS | — | V24 |
| C41 | "Same as TASK-x" | Stores `link`; question closes | Stored; closes | `PATCH /api/changesets/{id}` | PASS | — | V03 |
| C42 | "It is a new task" | Stores `new`; item stays a new task | Stored; operation `create` | PATCH | PASS | — | V31 |
| C43 | "Map speaker" (name + button) | Stores the identity; question closes | Stored (`confirmed_identity` true); toast | `PUT /api/meetings/{id}/participants/{label}` | PASS | — | V02 |
| C44 | Speaker question "Leave unassigned" | The item stays unassigned, or the review says why not | Answer stored, but the re-run rules drop the question and propose owner **Kavya**. Nothing on screen says the answer no longer applies | PATCH; `organizer_edits` keeps an answer that no longer matches a question | **FAIL (P0)** | Detect answers that no longer apply; show the ownership consequence; block approval until the organiser decides | V32 |
| C45 | Owner input + "Set owner" | Stores `set_owner`; item owner set | As expected | PATCH | PASS | — | V07 |
| C46 | Owner question "Leave unassigned" | Stores `unassigned` | As expected | PATCH | PASS | — | V07 |
| C47 | "Yes, X accepted" | Stores `accepted` | — | — | **BLOCKED** | No `pending_acceptance` question exists in any editable proposal in the data | — |
| C48 | Deadline candidate buttons | Store `set_due` with that date | As expected | PATCH | PASS | — | V05 |
| C49 | Due date input + "Use this date" | Stores the typed date | As expected | PATCH | PASS | — | V06 |
| C50 | "No deadline" | Stores `no_deadline` | As expected | PATCH | PASS | — | V06 |
| C51 | "Cancel the whole task" / "Keep the task" | Store the choice | — | — | **BLOCKED** | No open question of this kind (meeting 2's was answered before the audit) | — |
| C52 | "It is cancelled" / "Keep it" | Store the choice | — | — | **BLOCKED** | No question of this kind in the data | — |
| C53 | "Yes, that task" / "A new task" / "Drop it" | Store the choice | — | — | **BLOCKED** | No question of this kind in the data | — |
| C54 | "Not a team action" / "It is a genuine action" | Store the choice | — | — | **BLOCKED** | No question of this kind in the data | — |
| C55 | "Remove this dependency" (missing prerequisite) | Store `drop_dependency` | — | — | **BLOCKED** | No question of this kind in the data | — |
| C56 | Evidence chips | Scroll to and flash the transcript line | As expected | — | PASS | — | V11 |
| C57 | Hovering a card | Highlights its transcript lines | As expected | — | PASS | — | V12 |
| C58 | "How this was worked out" | Opens the numbered steps | As expected | — | PASS | — | V13 |
| C59 | Step segment buttons | Focus the line | As expected | — | PASS | — | V35 |
| C60 | "Edit" → "Save edits" | Stores organiser edits | Owner edit stored | PATCH `items` | PASS | — | V09 |
| C61 | "Edit" → "Cancel" | Discards edits | Nothing stored | — | PASS | — | V09 |
| C62 | Editing the title of an **existing** task | Shown as a change only if approval applies it | Shown as a rename (strike-through); approval keeps the old title | `_apply` never changes `title` on updates | **FAIL (P0)** | No title editing for existing tasks; say why | V29 |
| C63 | "Exclude" | Item excluded; its question disappears | As expected | PATCH `excluded: true` | PASS | — | V08 |
| C64 | "Include again" | Item and question come back | As expected | PATCH `excluded: false` | PASS | — | V08 |
| C65 | Remove a proposed dependency (×) | Stored | As expected | PATCH `drop_dependencies` | PASS | — | V10 |
| C66 | "Make it a task" dialog (owner, due, add) | The suggestion becomes a proposed task | Promoted (`state: proposed`, owner set) on a freshly processed meeting | PATCH `promote` | PASS | — | V27 (slow) |
| C67 | "Mentioned, no change" row | Expands its details | As expected | — | PASS | — | V23 |
| C68 | Decision checkbox | Stores `include` | Stored. The box only flips after the server answers | PATCH `decisions` | PASS | Keep the box in step with the server | V22 |
| C69 | "Change answer" | Removes the answer; question returns | As expected | PATCH `answers: null` | PASS | — | V04 |
| C70 | Stale-board notice + "Re-check against the current board" | Shown when the board changed; re-check snapshots the current board; Approve disabled until then | As expected | `POST /api/meetings/{id}/changeset/recompute` | PASS | — | V18 |
| C71 | 409 "changed since it was reviewed" + re-check | Recoverable; another tab's edit is picked up | As expected | approve 409 → recompute | PASS | — | V20 |
| C72 | Answers kept by a re-check | Earlier answers and exclusions survive | As expected | `organizer_edits` | PASS | — | V19 |
| C73 | "Reject all" dialog (Esc, "Keep reviewing", reason, confirm) | Only the confirm rejects | As expected | `POST /api/changesets/{id}/reject` | PASS | — | V14 |
| C74 | "Approve N change(s)" | Applies, then shows the applied result without a blank page | As expected | `POST /api/changesets/{id}/approve` | PASS | — | V15 |
| C75 | Approve gating | Disabled with open questions or a stale board | As expected | — | PASS | — | V01, V18 |
| C76 | Double-click / repeated approval | One approval; no duplicate task | One POST; server replay is idempotent | approve | PASS | — | V17 |
| C77 | Shown changes = applied changes (after a re-check) | Every field approval changes is flagged, and nothing else | Deadline flagged and applied. **Priority** (none → high) applied but not flagged | `_apply` updates priority when the organiser has not set one | **FAIL (P0)** | Build the change list from the rules `_apply` follows | V30 |
| C78 | Notice when an answer changes other items | The review says what changed | Owner of "Finish the login screen" changed from unassigned to Kavya after an unrelated answer; nothing tells the organiser | PATCH re-runs the rules | **FAIL (P0)** | After every change, list what changed since the previous version | V26b |
| C79 | Slow answer | Other choices disabled; one request | As expected | PATCH | PASS | — | V21 |
| C80 | "Open the task board" (applied banner) | Opens the board | As expected | route | PASS | — | V33 |
| C81 | Applied review is read-only | No edit, exclude, reject or approve controls | As expected | — | PASS | — | V25 |
| C82 | Unrelated review actions | Never alter approved tasks | Board unchanged after answers, exclusions, a decision toggle and a reject | `/api/tasks` unchanged | PASS | — | V28 |
| C83 | Anonymous speaker vs owners | An unrelated answer never maps SPEAKER_00; every owner traces to a name in the transcript | SPEAKER_00 stays unmapped; "Kavya" comes from s2, "Kavya, please finish the login screen by friday" | `/api/meetings/4` | PASS | — | V26a |

#### Meeting page (`/meetings/:id`)

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C84 | Breadcrumb "Overview" | Opens Overview | As expected | route | PASS | — | M15 |
| C85 | "Review changes" | Opens the review | As expected | route | PASS | — | M11 |
| C86 | "Re-run analysis" on an approved meeting | Refused with the reason | Refused; reason shown | `POST /process` 409 | PASS | — | M04 |
| C87 | "Delete" → "Keep it" / "Delete meeting" | Refused when approved tasks reference it; otherwise deleted | Both as expected | `DELETE /api/meetings/{id}` | PASS | — | M05, M06 |
| C88 | Speaker name + "Confirm" / "Rename" | Stored; acknowledged | As expected | PUT participants | PASS | — | M01 |
| C89 | Minutes segment links | Focus the line | As expected | — | PASS | — | M02 |
| C90 | Decision quote links | Focus the line | As expected | — | PASS | — | M03 |
| C91 | "Prepare summary" / "Prepare again" | Creates a summary version | As expected | `POST /api/meetings/{id}/summary` | PASS | — | M07, M14 |
| C92 | "Copy and mark approved" | Copies; approved for copying; nothing sent | As expected | `POST /api/summaries/{id}/approve` | PASS | — | M08 |
| C93 | Email recipients + "Approve and send" | Never claims sent without SMTP | State `approved` with "NOT sent"; no "Sent" shown | approve, channel `email` | PASS | — | M09 |
| C94 | "Show / Hide events" | Toggles the event list | As expected | — | PASS | — | M10 |
| C95 | Event segment links | Focus the line | As expected | — | PASS | — | M16 |
| C96 | Transcript timestamp | Seeks the recording | Seeks to the segment start | `<audio>` `currentTime` | PASS | — | M13 |
| C97 | `#segment` deep link | Scrolls to the line | As expected | — | PASS | — | M12 |
| C98 | Processing state and auto-refresh | Shows the step while processing; refreshes until done | "Queued"/"Interpreting" shown; "Processed" after about 3 min with no reload | `GET /api/meetings/{id}` every 3 s | PASS | — | N05 (slow) |

#### Add a meeting (`/meetings/new`)

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C99 | Meeting title | Required; stored | As expected | `POST /api/meetings` | PASS | — | N01, N07 |
| C100 | Date and time | Stored | As expected | `scheduled_at` | PASS | — | N07 |
| C101 | Meeting time zone | Stored | As expected | `timezone` | PASS | — | N07 |
| C102 | File chooser | Selects a file | As expected | — | PASS | — | N01 |
| C103 | Drag and drop | Selects the dropped file | As expected | — | PASS | — | N06 |
| C104 | "Remove file" | Clears the file | As expected | — | PASS | — | N02 |
| C105 | Consent checkbox | Upload stays disabled until it is ticked | As expected | — | PASS | — | N01 |
| C106 | "Upload and process", valid transcript | Creates, uploads, processes, opens the meeting | As expected (about 3 min with qwen3:8b) | create, upload, process | PASS | — | N05 (slow) |
| C107 | "Upload and process", unsupported file | Refused; no leftover meeting | Error shown, but an **empty meeting stays behind** | create 200, upload 415 | **FAIL** (P1) | Remove the just-created meeting when the upload is refused | N03 |
| C108 | "Upload and process", malformed transcript | Refused with the reason; no leftover meeting | Reason shown, but an **empty meeting stays behind** | create 200, upload 422 | **FAIL** (P1) | Same as C107 | N04 |

#### Task board (`/tasks`)

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C109 | Filter box | Narrows by code, title or owner | As expected | — | PASS | — | T01 |
| C110 | Owner filter | Narrows by owner | As expected | — | PASS | — | T02 |
| C111 | "Clear" | Resets both filters | As expected | — | PASS | — | T02 |
| C112 | Task card | Opens the drawer | As expected | `GET /api/tasks/{code}` | PASS | Add a list view (default) | T03 |
| C113 | Drawer "Close" / Esc | Close the drawer | As expected | — | PASS | — | T03 |
| C114 | "Move to" buttons | Store the status with a new revision | As expected | `PATCH /api/tasks/{code}` | PASS | — | T04 |
| C115 | Unfinished prerequisite | Start and finish disabled with the reason; server refuses too | As expected | 409 | PASS | — | T06 |
| C116 | Stale revision | Refused, and the drawer shows the current state | Refused with the reason, but the drawer **keeps showing the old revision** | 409 | **FAIL** (P2) | Reload the drawer after a conflict | T05 |
| C117 | ".ics" | Downloads a valid calendar file | As expected | `GET /api/tasks/{code}/event.ics` | PASS | — | T07 |
| C118 | Evidence links | Open the meeting at the line | As expected | route `#s4` | PASS | — | T08 |
| C119 | Origin link | Opens the source meeting | As expected | route | PASS | — | T11 |
| C120 | Reassignment identity | A reassignment keeps the task code and records revisions | TASK-2: rev 1 Priya → rev 2 Samiksha; one task | `/api/tasks/TASK-2` | PASS | — | T10 |

#### Calendar and reminders, agenda

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C121 | "Export calendar (.ics)" | Contains every approved due date | As expected | `GET /api/calendar.ics` | PASS | — | F01 |
| C122 | Reminder form (task, time, channel, recipients, "Draft reminder") | Creates a draft | As expected | `POST /api/reminders` | PASS | — | F02 |
| C123 | "Approve" (reminder) | Draft → scheduled | As expected | `POST /approve` | PASS | — | F02 |
| C124 | "Cancel" (reminder) | Scheduled → cancelled | As expected | `POST /cancel` | PASS | — | F02 |
| C125 | Email reminder without recipients | Refused with the reason | As expected | 422 | PASS | — | F03 |
| C126 | Email reminder delivery without SMTP | Never reported as delivered | `failed`, "SMTP not configured; not sent" | `/api/reminders` | PASS | — | F04 |
| C127 | "Deliver due reminders now" | Delivers due in-app reminders; says how many | As expected | `POST /api/reminders/run-due` | PASS | — | F05 |
| C128 | "Mark read" | Marks the notification read | As expected | `POST /api/notifications/{id}/read` | PASS | — | F06 |
| C129 | "Download as Markdown" (agenda) | Downloads the agenda | As expected | `GET /api/agenda.md` | PASS | — | F07 |
| C130 | Agenda source-meeting links | Open the meeting | As expected | route | PASS | — | F07 |
| C131 | Agenda pending-review links | Open the review | As expected | route | PASS | — | F08 |

#### Ask past meetings, Diagnostics

| ID | Control | Expected | Observed at 10deb16 | API / state | Result | Fix required | Test |
|---|---|---|---|---|---|---|---|
| C132 | Question + "Ask" | Sends the question | As expected | `POST /api/memory/query` | PASS | Chat layout | Q01 |
| C133 | "Write an answer with the model" | Off: passages only | As expected | `use_llm: false` | PASS | — | Q01 |
| C134 | Citation links | Open the meeting at the cited line | As expected | route | PASS | — | Q01, Q03 |
| C135 | Unsupported question | Says "not found in stored meetings" | As expected | `found: false` | PASS | — | Q02 |
| C136 | Request failure | Shown as a failure, not as "not found" | As expected | 500 shown as an error | PASS | — | Q05 |
| C137 | Model answer | Answer written only from cited passages | As expected (about 40 s) | `mode: llm_grounded` | PASS | — | Q03 (slow) |
| C138 | Model unavailable | Says so; shows passages; not "not found" | As expected | `mode: extractive`, `llm_error` | PASS | Label it clearly as "not an answer" | Q04 (slow) |
| C139 | Diagnostics content | Shows the configured services | As expected | `/api/diagnostics` | PASS | — | D01 |
| C140 | "Run live test" | Reports the real result | "passed: ollama/qwen3:8b" | `POST /api/diagnostics/llm-smoke` | PASS | — | D02 (slow) |

### Totals for 10deb16

**140 controls** inventoried: IDs C01–C140, where C09–C15 is the seven sidebar links on one
row. Each answer row for one question type (for example C51) counts as one control, even
though it has two or three buttons.

| Result | Controls | IDs |
|---|---|---|
| PASS | **124** | all others |
| FAIL | **8** | C06, C44, C62, C77, C78, C107, C108, C116 |
| BLOCKED | **6** | C47, C51, C52, C53, C54, C55: no question of these types exists in an editable proposal in the data |
| NOT IMPLEMENTED | **2** | C28, C30 |

**Untested controls.** The six BLOCKED controls could not be exercised, because no question
of those types exists in any editable proposal in the data. C30 (blocked-task rows) has no
browser test, because no task in the data is blocked; its NOT IMPLEMENTED result comes from
reading `Inbox.tsx`, where the rows are plain list items. Every other control was exercised
by at least one test above. Controls that only display information, such as the sidebar
runtime footer and the summary chips, are not counted.

### Defects found at 10deb16

| # | Severity | Defect | Controls | Root cause |
|---|---|---|---|---|
| D1 | **P0** | The review flags changes that approval does not apply, and misses changes it does apply. Priority none → high was applied but not shown. A title edit on an existing task was shown as a rename and never applied | C62, C77 | The UI derived "changes" from proposal fields. `changesets._apply` follows narrower rules: updates never change the title; a due date changes only when it differs; dependencies are only ever added; priority is applied unless the organiser set it on the board |
| D2 | **P0** | An organiser's explicit answer can be silently discarded, and the item is proposed with an owner anyway | C44 | Meeting 4's stored proposal (v1) was computed before rule change `4c3f7f8`: "an acceptance from an unmapped label does not erase an explicitly named owner". The next recompute (any answer) applies the new rule. The SPEAKER_00 question disappears, and `overlay()` ignores answers whose question no longer exists |
| D3 | **P0** | After an unrelated answer, another item's owner changes with no notice | C78 | Same mechanism as D2. The owner (Kavya) is valid: it comes from the spoken name in s2, and SPEAKER_00 is never mapped (C83 passes). But the change is silent |
| D4 | P1 | A refused upload leaves an empty meeting behind | C107, C108 | The UI creates the meeting before uploading and does not remove it when the upload is refused |
| D5 | P2 | The task drawer keeps a stale revision after a 409 conflict | C116 | No reload after the error |
| D6 | P2 | An expired or rotated token returns to sign-in without saying why | C06 | The 401 handler only flips to the sign-in screen |
| D7 | P2 | Overview deadline and blocked rows do not open the task | C28, C30 | Not implemented |

Other findings, not counted as failures:

- **The demo's meeting 3 cannot be approved as stored.** Its v2 proposal predates the
  current rules. The first approval returns 409 "changed since it was reviewed", and the UI
  then offers a re-check (C71, PASS). The re-checked v3 adds a TASK-2 deadline change
  (Oct 26 → Oct 27, from "naale finish maadthini") and a priority change.
- **Accessible-name noise.** The file input's accessible name includes the whole drop-zone
  text, and the reminder form's `<label>` wraps the option text. Neither is a functional
  failure.
- **Already-fixed defects confirmed:** approval no longer blanks the page (C74), excluded
  items' questions disappear (C63), the meeting 4 → meeting 3 conflict is recoverable
  (C70), a re-check keeps answers (C72), repeated approval is idempotent (C76), a
  reassignment keeps the task identity (C120), and an unfinished dependency blocks
  transitions (C115).

## Part B: rebuilt UI

Filled in after the rebuild. See the next commit.
