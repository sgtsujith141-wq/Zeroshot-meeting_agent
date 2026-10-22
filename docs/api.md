# API reference

Base URL: `http://127.0.0.1:8000`. Interactive OpenAPI docs: `/docs`.

Every endpoint except `GET /api/health` requires `Authorization: Bearer <ORGANIZER_TOKEN>`.
Errors return `{"detail": "..."}` with the following status codes:

| Status | Meaning |
|---|---|
| 401 | Missing or invalid token. |
| 403 | Consent missing, or an expired media link. |
| 404 | Not found. |
| 409 | State conflict: not approvable, stale proposal, revision mismatch, busy. |
| 413 | Upload too large. |
| 415 | File type not allowed. |
| 422 | Validation error. |
| 503 | `ORGANIZER_TOKEN` not configured. |

## Meetings and ingestion

| Method | Path | Notes |
|---|---|---|
| POST | `/api/meetings` | `{title, scheduled_at (ISO), timezone, consent_confirmed: true, consent_statement?, language_hint?}`. Rejects `consent_confirmed=false`. |
| GET | `/api/meetings` | List with processing status, segment count and latest change-set state. |
| GET | `/api/meetings/{id}` | Detail: participants, segments, minutes, decisions, open questions, interpretation events, LLM run metadata (provider, model, latency; no raw text), processing log. |
| POST | `/api/meetings/{id}/upload` | Multipart `file` (+ optional `auto_process`, default true). Transcript (`.json/.txt/.vtt/.srt`, ≤2 MB) or audio/video (≤`MAX_UPLOAD_MB`, must contain an audio stream). |
| POST | `/api/meetings/{id}/process` | `{steps: ["transcribe","interpret","minutes"]}`. Queues a background job; poll the meeting. |
| PUT | `/api/meetings/{id}/participants/{speaker_label}` | `{display_name, confirmed_identity}`. Maps or renames a speaker and re-folds the open change set (no model call). |
| PATCH | `/api/meetings/{id}/segments/{seg_key}` | `{text}`. Corrects a transcript segment (revision +1). |
| GET | `/api/meetings/{id}/media-url` | Returns a 1-hour HMAC-signed URL for the stored recording. |
| GET | `/api/meetings/{id}/media?sig&exp` | Streams the recording (signature required, no bearer token). |
| DELETE | `/api/meetings/{id}` | Deletes transcript, events, minutes, unapproved change sets, media and index rows. Returns 409 while approved tasks reference it. |

## Review and approval

| Method | Path | Notes |
|---|---|---|
| GET | `/api/changesets?state=` | List with item and open-question counts. |
| GET | `/api/meetings/{id}/changeset` | Latest change set for the meeting: `proposal` (items, clarifications, decisions_review, warnings, rejected_events, uncovered_segment_ids), `proposal_hash`, `segments` for evidence. |
| POST | `/api/meetings/{id}/changeset/recompute` | Deterministic re-fold against the current ledger. |
| PATCH | `/api/changesets/{id}` | `{answers: {"<item_key>\|<kind>": {choice, value} \| null}, items: {"<key>": {title, owner, due_date, priority, excluded, promote, drop_dependencies}}, decisions: {"<id>": {include, text}}}`. Answer choices are validated per question kind. |
| POST | `/api/changesets/{id}/approve` | `{proposal_hash}`. 409 if questions remain, if the hash is stale, or if a task changed concurrently (apply rolled back, state `FAILED`). Repeating it returns `idempotent_replay: true`. |
| POST | `/api/changesets/{id}/reject` | `{reason?}` |

Clarification kinds and allowed answer choices:

| Kind | Choices |
|---|---|
| `missing_owner`, `group_owner`, `unmapped_speaker` | `set_owner` (value), `unassigned` |
| `pending_acceptance` | `accepted`, `set_owner`, `unassigned` |
| `ambiguous_deadline` | `set_due` (value YYYY-MM-DD), `no_deadline` |
| `ambiguous_cancellation_existing` | `cancel_task`, `keep_task` |
| `ambiguous_cancellation_new` | `cancel`, `keep` |
| `possible_existing_match`, `ambiguous_reference` | `link` (value TASK-n), `new` |
| `unverified_reference` | `confirm`, `new`, `drop` |
| `instruction_to_assistant` | `drop`, `keep` |
| `missing_prerequisite` | `drop_dependency`, `link` (value) |

## Tasks

| Method | Path | Notes |
|---|---|---|
| GET | `/api/tasks?status=&owner=` | Approved tasks with prerequisites, dependents, `is_blocked` and allowed transitions. |
| GET | `/api/tasks/{code}` | Adds revisions (immutable snapshots), evidence with transcript text and meeting, calendar event, reminders. |
| PATCH | `/api/tasks/{code}` | `{expected_revision, status?, owner?, due_date?, priority?, blocked_reason?, title?}`. Uses the finite transition table. Moving to `in_progress`/`done` requires finished prerequisites. Returns 409 on a revision mismatch. |
| POST | `/api/tasks/{code}/dependencies` | `{prerequisite_code}`. Returns 409 on a cycle. |
| DELETE | `/api/tasks/{code}/dependencies/{prereq}` | |

There is deliberately no endpoint that creates a task directly. Tasks only come from
approved change sets.

## Follow-up

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calendar` | In-app all-day events for approved tasks with due dates. |
| GET | `/api/calendar.ics`, `/api/tasks/{code}/event.ics` | RFC 5545 export (`VALUE=DATE`, `X-WR-TIMEZONE`). Marks events `exported`. |
| GET/POST | `/api/reminders` | POST `{task_code, scheduled_at, channel: in_app\|email, recipients, message?}` creates a **draft**. |
| POST | `/api/reminders/{id}/approve`, `/cancel` | Approval schedules it. Email also needs SMTP. |
| POST | `/api/reminders/run-due` | Delivers due reminders now with the real clock (same code path as the worker). |
| GET | `/api/notifications`, POST `/api/notifications/{id}/read` | In-app deliveries. |
| POST | `/api/meetings/{id}/summary` | Prepares a summary from approved data. |
| GET | `/api/meetings/{id}/summaries` | Includes `content_hash`. |
| POST | `/api/summaries/{id}/approve` | `{channel: copy\|email, recipients, content_hash}`. Sends only if SMTP is configured; otherwise the state is `approved` with "NOT sent". |
| GET | `/api/agenda`, `/api/agenda.md` | Next-meeting agenda from stored state. |
| POST | `/api/memory/query` | `{question, use_llm}` returns `answer`, `found`, `mode`, `citations` (validated), `passages`, `current_state`. |
| GET | `/api/memory/search?q=` | FTS5 passages only. |

## System and evaluation

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | DB check, clock (real/simulated), reminder worker status. No auth. |
| GET | `/api/diagnostics` | LLM/STT/SMTP status, app model-call stats, evaluation runs. |
| POST | `/api/diagnostics/llm-smoke` | One real structured request to the active model. |
| GET | `/api/evaluation/results`, `/api/evaluation/results/{run_id}` | Recorded fixture runs. |
| POST | `/api/evaluation/run` | `{provider?, model?, cases?}` starts `evaluation/run_eval.py` in a subprocess. |
| GET | `/api/audit?limit=` | Audit trail. |
