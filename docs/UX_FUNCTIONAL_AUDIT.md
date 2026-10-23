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

### What changed structurally

| Before (10deb16) | After |
|---|---|
| Seven sidebar destinations, plus a duplicate "New meeting" button, plus a theme toggle and sign-out in the sidebar | Six destinations (Overview, Meetings, Approvals, Tasks, Ask AI, Follow-ups). Diagnostics, theme and sign-out are in a secondary **More** menu. "New meeting" is the primary action of Meetings and Overview only |
| Overview: four card panels plus an activity feed and a meetings table | One queue: pending approvals, meetings requiring attention, upcoming tasks, blocked work, recent meetings. Compact rows, each opening where you act |
| No meetings list (meetings only reachable from Overview) | **Meetings**: a searchable table with one plain status per meeting |
| Meeting page: a column of eight panels | Workspace: transcript beside four tabs (Summary, Actions, Speakers, Processing). Re-run and Delete sit behind a menu with confirmation dialogs |
| Review: one large card per proposed item, field diffs inside cards | **Approvals**: one table (Task, Change, Current, Proposed, Status) built from the same rules approval applies. Details, evidence, questions, edits and history are in a drawer |
| Task board: kanban only | **Tasks**: a list by default (owner, due, status, priority, dependencies, meeting). The board is an optional view. `?task=` opens the drawer from anywhere |
| Ask past meetings: one query box, one result panel | **Ask AI**: a chat with five clearly different outcomes (answer, not supported, nothing found, model unavailable, request failed) |
| Calendar & reminders and Next agenda as two pages of panels | **Follow-ups**: one page with tabs (Agenda, Calendar, Reminders, Notifications) |
| Chips, tinted panels and shadows on every element | Status shown as a dot and a word, hairline dividers, no cards. One accent colour, used for the primary action |

### Routes

| Route | Screen |
|---|---|
| `/` | Overview |
| `/meetings` | Meetings |
| `/meetings/new` | New meeting |
| `/meetings/:id` | Meeting workspace (`#s12` focuses a line) |
| `/approvals` | Approvals |
| `/approvals/:meetingId` | One meeting's proposed changes |
| `/tasks` | Tasks (`?view=board`, `?task=TASK-3`) |
| `/ask` | Ask AI |
| `/follow-ups` | Follow-ups (`?tab=calendar` / `reminders` / `notifications`) |
| `/diagnostics` | Diagnostics (from the More menu) |
| `/review`, `/review/:id`, `/memory`, `/follow-up`, `/agenda` | Redirect to the new pages, so old links keep working |
| `*` | Overview |

That is 10 routes, 5 redirects and the catch-all, all of them audited.

### Test runs (rebuilt UI)

All in a real browser against real sandboxed backends. The fixture fails every test on page
errors, console errors and undeclared API failures.

| Suite | Tests | Result |
|---|---|---|
| `flows/shell.spec.ts` (sign-in, session, navigation, menus, redirects, phone menu, errors, empty database) | 13 | 13 pass |
| `flows/approvals.spec.ts` | 25 | 25 pass |
| `flows/questions.spec.ts` (six question types, from recorded test events) | 7 | 7 pass |
| `flows/meetings.spec.ts` (Overview, Meetings, workspace, upload form) | 15 | 15 pass |
| `flows/tasks-ask-followups.spec.ts` | 15 | 15 pass |
| `flows/links.spec.ts` (remaining links, references, orphaned-answer actions, keyboard focus containment) | 9 | 9 pass |
| `flows/a11y.spec.ts` (axe-core, WCAG 2.1 A and AA: sign-in and 16 routes in both themes, plus the drawers and dialogs) | 3 | 3 pass: 0 violations |
| `flows/slow.spec.ts` (live local model: upload, processing, re-run, promote, approve; grounded answer; model down; live test) | 4 | 4 pass |
| `smoke.spec.ts` against the live demo server, read-only | 4 | 4 pass |
| `screens.spec.ts`: every route at 1440, 1024 and 390 px, plus light theme at 1440 and 390 | 5 runs | 5 pass: no horizontal overflow, no control cut off |

That is 91 flow tests and 4 smoke tests, all passing. The fast set (87 tests) ran in a
single run of 283 s; the live-model set ran in 5.6 min. Backend: 107 tests pass. The backend is
unchanged by this rebuild.

**Data used.** Sandboxes copy a pinned snapshot of the demo data
(`frontend/e2e/.demo-snapshot`, git-ignored): 4 synthetic meetings, meetings 1 and 2
approved. This keeps results stable while people use the live demo. During this audit a
"TEST" meeting was uploaded through the live server by hand; it is not in the snapshot.

`questions.spec.ts` seeds one extra sandbox meeting. It uses recorded model events (provider
`test-fixture`, the same mechanism the backend tests use), so the real reconciliation rules
raise the question types that no stored proposal contains. Only that sandbox is affected.

### Control inventory and results

Each control was exercised in the browser, and its effect was checked through the API where
it writes. The Test column names the spec file.

#### Sign in, session, shell

| ID | Control | Expected | Result | API / state | Test |
|---|---|---|---|---|---|
| B01 | Organiser token input | Masked; required | PASS | — | shell |
| B02 | Sign in | Disabled when empty; wrong token refused and not kept; valid token opens Overview | PASS | `GET /api/meetings` | shell |
| B03 | Sign-in error | Shows the server's reason | PASS | 401 detail | shell |
| B04 | "You were signed out" notice | After a rotated or expired token, says why; clears on the next sign-in | PASS | 401 → sign-in | shell |
| B05 | Deep link while signed out | Sign-in; no API call made | PASS | none | shell |
| B06 | API without a token | 401 everywhere | PASS | 401 | shell |
| B07 | Brand link | Overview | PASS | route | links |
| B08–B13 | Overview, Meetings, Approvals, Tasks, Ask AI, Follow-ups | Each opens its page and is marked current | PASS | routes | shell |
| B14 | Sidebar counts | Equal the API ("2 waiting", "3 open") | PASS | `/api/changesets`, `/api/tasks` | shell |
| B15 | More menu | Opens; arrow keys move; Esc closes and returns focus | PASS | — | shell |
| B16 | More → Diagnostics | Opens Diagnostics | PASS | route | shell |
| B17 | More → Switch theme | Switches; persists after reload | PASS | `localStorage` | shell |
| B18 | More → Sign out | Clears the token | PASS | `sessionStorage` | shell |
| B19 | Unknown route | Overview | PASS | redirect | shell |
| B20 | Five earlier addresses | Redirect to the new pages | PASS | redirects | shell |
| B21 | Phone menu | Opens; choosing a page closes it | PASS | — | shell |
| B22 | Phone menu: Diagnostics, theme, sign out | Each works and closes the menu | PASS | — | shell, links |
| B23 | Toast "Dismiss" | Removes the toast | PASS | — | shell |
| B24 | "Try again" after a failed load | Recovers once the server answers | PASS | retry | shell |
| B25 | Unreachable server | Says the server cannot be reached | PASS | network error | shell |

#### Overview and Meetings

| ID | Control | Expected | Result | API / state | Test |
|---|---|---|---|---|---|
| B26 | "New meeting" (Overview) | Upload form | PASS | route | meetings |
| B27 | Pending-approval rows | Match the API; open the approval | PASS | `/api/changesets` | meetings |
| B28 | "All approvals" | Approvals | PASS | route | links |
| B29 | Upcoming-task rows | Open the task drawer | PASS | `/tasks?task=` | meetings |
| B30 | "All tasks" | Tasks | PASS | route | links |
| B31 | Meetings-requiring-attention rows | Listed; open the meeting | PASS | `/api/meetings` | meetings |
| B32 | Blocked-work rows | Listed with the prerequisite; open the task drawer | PASS | `/api/tasks` | meetings |
| B33 | Recent-meeting rows | Open the meeting | PASS | route | meetings |
| B34 | "All meetings" | Meetings | PASS | route | links |
| B35 | Empty database: "Add a meeting" | Upload form | PASS | — | links |
| B36 | "New meeting" (Meetings) | Upload form | PASS | route | links |
| B37 | Meeting search | Narrows by title | PASS | — | meetings |
| B38 | Status filter | Narrows by status | PASS | — | meetings |
| B39 | Meeting row / title | Opens the workspace | PASS | route | meetings |

#### Meeting workspace and New meeting

| ID | Control | Expected | Result | API / state | Test |
|---|---|---|---|---|---|
| B40 | Breadcrumb "Meetings" | Meetings | PASS | route | links |
| B41 | "Review proposed changes" / "View approval" | Opens the approval | PASS | route | meetings, links |
| B42 | More → Re-run analysis | Dialog; Cancel does nothing; refused with the reason when approved; runs and refreshes when not | PASS | `POST /process` | meetings, slow |
| B43 | More → Delete meeting | "Keep it" does nothing; refused when approved tasks depend on it; otherwise deleted | PASS | `DELETE /api/meetings/{id}` | meetings |
| B44 | Tabs | Click and arrow keys | PASS | — | meetings |
| B45 | Transcript tab (phone) | Shows the transcript | PASS | — | meetings |
| B46 | Minutes references | Focus the line | PASS | — | meetings |
| B47 | Decision references | Focus the line | PASS | — | links |
| B48 | Actions tab and its approval link | Lists actions with status; link opens the approval | PASS | `GET changeset` | meetings, links |
| B49 | Speaker name + Confirm / Rename | Stored; acknowledged | PASS | `PUT participants` | meetings |
| B50 | Show / Hide events | Toggles | PASS | — | meetings, links |
| B51 | Event references | Focus the line | PASS | — | meetings |
| B52 | Prepare summary / Prepare again | New summary version | PASS | `POST /summary` | meetings |
| B53 | Copy and mark approved | Copied; approved; nothing sent | PASS | `POST /summaries/{id}/approve` | meetings |
| B54 | Email recipients + "Approve and send" | Without SMTP: "Approved for email, NOT sent" | PASS | state `approved`, error "NOT sent" | meetings |
| B55 | Transcript timestamp | Plays from that point | PASS | `<audio>` `currentTime` | meetings |
| B56 | `#segment` link | Focuses the line | PASS | — | meetings |
| B57 | Processing notice and self-refresh | Shows the step; refreshes until done, also after a re-run | PASS | poll `GET /api/meetings/{id}` | meetings, slow |
| B58 | Breadcrumb (New meeting) | Meetings | PASS | route | links |
| B59–B61 | Title, date and time, time zone | Sent exactly as typed | PASS | `POST /api/meetings` body | meetings |
| B62 | Choose a file | Selects it | PASS | — | meetings |
| B63 | Drop a file | Selects it | PASS | — | meetings |
| B64 | Remove file | Clears it | PASS | — | meetings |
| B65 | Consent checkbox | Required before upload | PASS | — | meetings |
| B66 | Upload and process | Valid file → processing → proposal. Refused file → reason shown and **nothing left behind** | PASS | create, upload, cleanup `DELETE` | meetings, slow |

#### Approvals

| ID | Control | Expected | Result | API / state | Test |
|---|---|---|---|---|---|
| B67 | Waiting / All tabs | Match the API | PASS | `/api/changesets` | approvals |
| B68 | Approval row / title | Opens it | PASS | route | approvals |
| B69 | Breadcrumb "Approvals" | Approvals | PASS | route | links |
| B70 | "Transcript" | Drawer with the full transcript; Esc closes | PASS | — | approvals |
| B71 | "Open meeting" | Workspace | PASS | route | links |
| B72 | Change-table row / task title | Opens the details drawer | PASS | — | approvals |
| B73 | "Show N items that will not change the board" | Reveals them | PASS | — | approvals |
| B74 | "Same as TASK-x" | Stores `link` | PASS | `PATCH answers` | approvals |
| B75 | "It is a new task" | Stores `new` | PASS | PATCH | approvals |
| B76 | Speaker name + "Map speaker" | Stores the identity (explicit only) | PASS | `PUT participants` | approvals |
| B77 | Speaker "Leave unassigned" | Stored; if the server stops using it, surfaced (B93–B95) | PASS | PATCH | approvals |
| B78 | Owner + "Set owner" | Stores `set_owner` | PASS | PATCH | approvals |
| B79 | Owner "Leave unassigned" | Stores `unassigned` | PASS | PATCH | approvals |
| B80 | "Yes, X accepted" | Stores `accepted`; X becomes owner | PASS | PATCH | questions |
| B81 | Deadline candidates | Store `set_due` | PASS | PATCH | approvals |
| B82 | Due date + "Use this date" | Stores the typed date | PASS | PATCH | approvals |
| B83 | "No deadline" | Stores `no_deadline` | PASS | PATCH | approvals |
| B84 | "Cancel the whole task" / "Keep the task" | Stored; cancel shows "Cancel task: To do → Cancelled" | PASS | PATCH | questions |
| B85 | "It is cancelled" / "Keep it" | Stored with their effect | PASS | PATCH | questions |
| B86 | "Yes, that task" / "A new task" / "Drop it" | Stored with their effect | PASS | PATCH | questions |
| B87 | "Not a team action" / "It is a genuine action" | Stored with their effect | PASS | PATCH | questions |
| B88 | "Remove this dependency" | Stored; asked only once the item is known to be new | PASS | PATCH | questions |
| B89 | Question "Details of …" | Opens that item's drawer | PASS | — | links |
| B90 | Question evidence | Opens the transcript at the line | PASS | — | links |
| B91 | "Your answers" → "Change answer" | Removes the answer | PASS | PATCH `null` | approvals |
| B92 | "What changed after your last action" + Dismiss | Lists every changed item and question after any action | PASS | diff of versions | approvals |
| B93 | Orphaned answer: "Leave it unassigned" | Applies the earlier choice; clears the stale answer | PASS | PATCH items + answers | approvals |
| B94 | Orphaned answer: "Keep the current proposal" | Accepts the proposal; clears the stale answer | PASS | PATCH | approvals |
| B95 | Orphaned answer: "Make X the owner" / "Use date" / "Remove the due date" | Each applies the earlier answer | PASS | PATCH | links |
| B96 | Re-check after a board change | Snapshots the current board; answers kept | PASS | `POST recompute` | approvals |
| B97 | Re-check after a 409 conflict | Recoverable; changes listed | PASS | approve 409 → recompute | approvals |
| B98 | Drawer: Edit / Save edits / Cancel | Owner, due and priority stored; title only for new tasks | PASS | PATCH items | approvals |
| B99 | Drawer: Exclude / Include again | Stored; the item's question disappears and returns | PASS | PATCH | approvals |
| B100 | Drawer: Remove proposed dependency | Stored | PASS | PATCH | approvals |
| B101 | Drawer: "Make it a task" | A suggestion becomes a proposed task with an owner; approval creates it | PASS | PATCH `promote`; approve | slow |
| B102 | Drawer: "Show … in transcript" | Transcript at the line | PASS | — | approvals |
| B103 | Drawer: "Change answer" | Works for items whose questions are hidden because the item is excluded | PASS | PATCH | questions |
| B104 | Drawer: step references | Transcript at the line | PASS | — | links |
| B105 | Drawer: Close / Esc | Close | PASS | — | approvals |
| B106 | Decision checkboxes | Stored; the box follows the click immediately | PASS | PATCH decisions | approvals |
| B107 | Decision references | Transcript at the line | PASS | — | links |
| B108 | Checks references | Transcript at the line | PASS | — | links |
| B109 | "Reject all" dialog | Esc and "Keep reviewing" cancel; confirming rejects with the reason; page becomes read-only | PASS | `POST /reject` | approvals |
| B110 | Approve | Applies; the page then re-reads the server and shows the recorded result | PASS | `POST /approve` | approvals |
| B111 | Approve gating | Disabled, with the reason, for open questions, a stale board or orphaned answers | PASS | — | approvals |
| B112 | Double-click / repeated approval | One request; replay creates nothing | PASS | idempotent replay | approvals |
| B113 | Slow save | Other choices disabled; one request | PASS | PATCH | approvals |
| B114 | "Open tasks" (applied) | Tasks | PASS | route | links |
| B115 | Applied view | Before / After from the task revisions approval recorded | PASS | `GET /api/tasks/{code}` | approvals |

#### Tasks, Ask AI, Follow-ups, Diagnostics

| ID | Control | Expected | Result | API / state | Test |
|---|---|---|---|---|---|
| B116 | List / Board tabs | Switch; kept in the address | PASS | `?view=board` | tasks-ask-followups |
| B117 | Task search | Narrows | PASS | — | tasks-ask-followups |
| B118 | Owner filter | Narrows | PASS | — | tasks-ask-followups |
| B119 | Status filter | Narrows (open by default) | PASS | — | tasks-ask-followups |
| B120 | "Clear" | Resets | PASS | — | tasks-ask-followups |
| B121 | Task row / title | Opens the drawer | PASS | `?task=` | tasks-ask-followups |
| B122 | Board card | Opens the drawer | PASS | — | tasks-ask-followups |
| B123 | `?task=` link | Opens the drawer directly | PASS | — | tasks-ask-followups |
| B124 | "Move to" | Stored with a new revision | PASS | `PATCH /api/tasks/{code}` | tasks-ask-followups |
| B125 | Unfinished prerequisite | Start and finish disabled with the reason; server refuses too | PASS | 409 | tasks-ask-followups |
| B126 | Change made elsewhere | Refused, explained, and the drawer shows the current revision | PASS | 409 → reload | tasks-ask-followups |
| B127 | "Download .ics" | Valid calendar entry | PASS | `event.ics` | tasks-ask-followups |
| B128 | Evidence links | Meeting at the line | PASS | route | tasks-ask-followups |
| B129 | Origin link | Source meeting | PASS | route | tasks-ask-followups |
| B130 | Drawer Close / Esc | Close | PASS | — | tasks-ask-followups |
| B131 | Empty: "Go to Approvals" | Approvals | PASS | route | links |
| B132 | Question box (Enter sends) | Sends | PASS | `POST /api/memory/query` | tasks-ask-followups |
| B133 | "Ask" | Sends | PASS | same | tasks-ask-followups |
| B134 | "Write an answer with the model" | Off: passages only | PASS | `use_llm` | tasks-ask-followups |
| B135 | Outcome: answer from the records | Labelled; only cited passages; citations open the line | PASS | `llm_grounded`, found | slow |
| B136 | Outcome: not supported by the records | Labelled as not an answer; closest passages shown | PASS* | `llm_grounded`, not found | tasks-ask-followups |
| B137 | Outcome: nothing found | Labelled | PASS | `retrieval` | tasks-ask-followups |
| B138 | Outcome: model unavailable | Labelled; passages are not an answer | PASS | `extractive` + `llm_error` | slow |
| B139 | Outcome: request failed + "Try again" | Labelled differently from "not found"; retry works | PASS | 500 → retry | tasks-ask-followups |
| B140 | Source links | Meeting at the line | PASS | route | tasks-ask-followups |
| B141 | "Current approved state" links | Task drawer | PASS | route | links |
| B142 | Follow-ups tabs | Switch; kept in the address | PASS | `?tab=` | tasks-ask-followups |
| B143 | Agenda "Download as Markdown" | Downloads | PASS | `agenda.md` | tasks-ask-followups |
| B144 | Agenda task, meeting and approval links | Open them | PASS | routes | tasks-ask-followups, links |
| B145 | "Export calendar (.ics)" | Every due date | PASS | `calendar.ics` | tasks-ask-followups |
| B146 | Calendar task links | Task drawer | PASS | route | links |
| B147 | "New reminder" dialog (task, when, channel, recipients, Draft, Cancel) | Drafts; Cancel does nothing; email without recipients is refused inside the dialog | PASS | `POST /api/reminders` | tasks-ask-followups, links |
| B148 | Reminder "Approve" | Draft → scheduled | PASS | `POST /approve` | tasks-ask-followups |
| B149 | Reminder "Cancel" | → cancelled | PASS | `POST /cancel` | tasks-ask-followups |
| B150 | "Deliver due reminders now" | In-app delivered; email without SMTP shown as "Not sent" with the reason | PASS | `POST /run-due` | tasks-ask-followups |
| B151 | Reminder task links | Task drawer | PASS | route | links |
| B152 | Notification "Mark read" | Stored | PASS | `POST /read` | tasks-ask-followups |
| B153 | Diagnostics "Run live test" | Reports the real result | PASS | `POST /llm-smoke` | slow |
| B154 | Diagnostics content | Services and evaluation table, evenly aligned | PASS | `/api/diagnostics` | shell, smoke |

\* **B136.** Whether the live model declines to answer depends on its output, so this test
drives the UI with a response in exactly the shape `memory.answer` returns for that branch
(`mode: llm_grounded`, `found: false`). The test checks the labelling; it does not claim the
model produced that outcome.

For B135, the live run of qwen3:8b answered "Samiksha owns the regression tests, and they
are due on 2026-10-26", citing five valid passages.

### Totals for the rebuilt UI

| Result | Controls |
|---|---|
| PASS | **154** of 154 (B01–B154) |
| FAIL | 0 |
| BLOCKED | 0 (the six blocked at 10deb16 are now tested through recorded test events) |
| NOT IMPLEMENTED | 0 (deadline and blocked rows now open the task) |

### Defects fixed

| # | Severity | Defect | Fix | Verified by |
|---|---|---|---|---|
| D1 | **P0** | The review showed changes approval does not apply (renaming existing tasks) and hid ones it does (a priority set by linking or re-checking: TASK-3 Medium → High, TASK-2 none → High) | `lib/changes.ts` builds the table from the same rules `changesets._apply` follows. Existing tasks show their board title and cannot be renamed in the review. Dependencies that approval keeps are explained | approvals: "approving applies exactly…", "P0: after a re-check…" |
| D2 | **P0** | An organiser answer the server stopped using after a re-check was dropped silently, and the item got an owner anyway | Answers that no longer match a question are listed with their consequence and blocking approval. One click applies the earlier answer, or keeps the proposal | approvals: two "P0" tests; links |
| D3 | **P0** | An unrelated answer silently changed another item's owner | After every action, the page lists each item and question that changed between versions | approvals: "P0: an unrelated answer…" |
| D4 | P1 | A refused upload left an empty meeting | The meeting created for the upload is deleted when the upload is refused, and the message says nothing was saved | meetings: two refusal tests |
| D5 | P2 | The task drawer kept a stale revision after a 409 | The drawer reloads and explains what changed | tasks-ask-followups |
| D6 | P2 | An expired token returned to sign-in silently | Sign-in says why the session ended | shell |
| D7 | P2 | Deadline and blocked rows on Overview did not open the task | Rows open the task drawer | meetings |
| D8 | P1 | **Found while testing the rebuild, also present at 10deb16:** after "Re-run analysis" the meeting page claimed to refresh by itself but never did | Polling is re-armed after every load. The regression test fails on the old code and passes on the fix | meetings: "keeps refreshing…"; slow |
| D9 | P2 | Found while testing the rebuild: the phone menu stayed open after switching theme | Every phone-menu item closes the menu | links |
| D10 | P2 | Found in visual QA: on phones, the meeting tabs and the reminder "Cancel" buttons were cut off | Tabs wrap; dates wrap. `screens.spec.ts` now fails on any control outside the viewport | screens at 390 px |
| D11 | P2 | Found by the accessibility check: secondary ("faint") text was below the 4.5:1 WCAG AA contrast minimum (3.6–4.4:1 dark, 3.1–3.7:1 light) | Faint tokens changed to `#8A929C` (dark) and `#626A74` (light); at least 4.9:1 and 4.6:1 on every surface they sit on | a11y: 0 violations |

### Visual QA

- **Widths and themes:** real viewport screenshots (not full-page) of every route at 1440,
  1024 and 390 px, plus light theme at 1440 and 390. Long pages are also captured scrolled
  to the end, which shows the sticky approval bar where it really sits.
- **Checks on every route:** no horizontal page overflow, and no button, link or field
  outside the viewport.
- **Inspected by eye:** the approval table and bar (all widths), the drawers, the phone
  menu, the tab wrapping, the light theme, and keyboard focus on menus and tabs.
- **Accessibility:** axe-core with the WCAG 2.1 A and AA rules finds no violations on any
  route, in either theme, or in the drawers and dialogs. Its first run found only
  colour-contrast issues, fixed as D11. Keyboard: menus (Enter, arrows, Esc returning
  focus), tabs (arrows), and dialogs and drawers (Esc, focus kept inside) are tested.
  A screen-reader walkthrough was not done.
- **Screenshot locations** (local, not committed):
  - before (10deb16): the full-page captures from the previous sprint;
  - after: `final-ux/` in the session scratchpad.
