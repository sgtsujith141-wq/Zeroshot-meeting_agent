# Submission checklist (PS 5.3)

Status key:

| Status | Meaning |
|---|---|
| **PASS** | Implemented and verified by an executed test or a live run, cited. |
| **PARTIAL** | Works with a stated gap. |
| **UNVERIFIED** | Implemented but not executed against the real service. |
| **FAIL** | Not done. |

Verification environment: local Ollama `qwen3:8b` / `llama3.1:8b` on CPU, no Gemini or
Sarvam keys, no SMTP, synthetic transcripts only.

## Problem-statement requirements

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Ingest transcripts | **PASS** | JSON / Sarvam JSON / VTT / SRT / text parsers. Live ingestion of 3 synthetic meetings via API and UI. `test_full_flow_transcript_to_approved_tasks`. |
| 1b | Ingest audio/video recordings | **PARTIAL** | Verified 2026-10-23 through the real UI upload: a synthetic TTS recording went through ffprobe/FFmpeg, then **local faster-whisper-small**, then interpretation, minutes and the change set (meeting 4; Playwright walkthrough). **Sarvam batch STT is UNVERIFIED** (no `SARVAM_API_KEY`); the adapter is checked against the installed SDK only. No real recording processed. |
| 2 | Identify speakers; correct/rename | **PARTIAL** | Rename/map speakers in the UI re-folds proposals with no model call (walkthrough: SPEAKER_03 → Meera). **Diarization is UNVERIFIED**: Sarvam not run. Local Whisper has no diarization, so every segment is SPEAKER_00, and with no speaker separation "I will" cannot be attributed. |
| 3 | English + ≥1 Indian language / code-mixed | **PARTIAL** | Code-mixed *text*: starter T06; holdout v1 H03/H04, v2 V01/V02/V05/V10; synthetic meeting 3 live. Code-mixed *speech*: only a synthetic TTS clip through local Whisper (WER 0.245; Kannada written phonetically in Devanagari, and the earlier default inverted a Kannada line's meaning). **Real code-mixed speech NOT MEASURED.** |
| 4 | Minutes, discussion, decisions **and reasons**, unresolved questions | **PARTIAL** | Generated live with evidence validation. Fixed 2026-10-23: assignment-like "decisions" are moved to actions (live: 2 moved in meeting 4). Remaining gap: the 8B model often misses stated reasons. |
| 5 | Actions with owner, due date, priority, dependencies; flag unclear owner/deadline | **PASS** | Live runs and 23 reconcile/date tests. Ranked clarification questions (missing, anonymous or group owner; ambiguous deadline). |
| 6 | Organiser review, edit, approve before tasks/messages | **PASS** | Hash-pinned server-side approval. No direct task creation route. `test_full_flow…` (stale hash → 409), `test_ambiguous_cancellation_blocks_approval_until_answered`, `test_prompt_injection_cannot_create_task_or_send`. Live UI approvals of meetings 1 and 2. |
| 7a | Persistent task board | **PASS** | SQLite. `test_data_persists_across_restart`. Live server restart kept meeting data. |
| 7b | Calendar-event handling | **PASS** (in-app + `.ics` export) | `test_calendar_ics_and_agenda` (all-day `VALUE=DATE`, `X-WR-TIMEZONE`). **No third-party calendar sync** (labelled as export). |
| 7c | Email/chat summary sharing, approval-controlled | **PARTIAL** | Prepared → approved with explicit recipients → sent only via SMTP. No SMTP was configured, so **no email has ever been sent**. The UI and API say "approved but NOT sent". |
| 8a | Track task status, blockers | **PASS** | Finite transition table, prerequisite gating, cycle protection: `test_task_state_machine_and_dependencies`. Live: TASK-1 done → TASK-2 unblocked in the UI. |
| 8b | Deliver/schedule follow-ups as authorised | **PASS** (in-app) | Real-clock delivery: reminder 4 scheduled 17:43:23Z, delivered 17:43:35Z by the background worker (2026-10-22). Simulated-clock test: `test_reminder_fires_under_simulated_clock`. Email reminders need approval and SMTP (unverified). |
| 8c | Future-meeting agenda of pending items | **PASS** | `/api/agenda` from DB state with source-meeting links; `test_calendar_ics_and_agenda`. |
| 9 | Search / Q&A across meetings, anchored to segments | **PASS** | FTS5 with citation validation, "not found in stored meetings", and current-state vs originally-said views. `test_memory_grounded_and_not_found`, Kannada-script test, plus a live query (see the README run log). |
| 10 | Evidence for every decision and action | **PASS** | Segment IDs validated for every event, decision and question. Quotes shown in review, meeting and task views. |
| 11 | Demo on ≥3 **real** meetings, ≥1 code-mixed | **FAIL** | No real recordings received yet. Synthetic transcripts and one synthetic TTS recording only. The procedure is runnable: `evaluation/real_eval.py init/export/report`. |
| 12 | Source, README, architecture diagram | **PASS** | This repository, `README.md`, `docs/architecture.md` (Mermaid). |
| 13 | Measurable WER | **FAIL: NOT MEASURED** | No real meetings yet. Tooling verified (unit tests, plus a mechanical run on synthetic TTS: 0.245). |
| 14 | Action precision/recall vs human-annotated actions | **PARTIAL** | Synthetic only: starter kit (pre-registered), holdout v1 and fresh holdout v2 (see `docs/evaluation.md`). Real meetings: **NOT MEASURED**. |
| 15 | Human-rated summary quality | **FAIL: NOT MEASURED** | Rubric, template and `export` of the system summary ready; no ratings collected. |
| 16 | 5–7 minute pitch | **PARTIAL** | `docs/demo-script.md` (talk track). No slides or video file has been produced. |

## Our differentiation (brief §2–3)

| Item | Status | Evidence |
|---|---|---|
| Chronological typed events, deterministic reconciliation, targeted clarification | **PASS** | `backend/app/services/reconcile.py`, 23 fold tests. |
| Baseline vs candidate on the same model, fixtures, per-case mismatches logged | **PASS** | `evaluation/results/*`, `docs/evaluation.md`. |
| Feasibility gate decision | **PASS** | Kept: better on targeted failure classes with both models; weaker dependency recall documented. |
| Gemini as the evaluated model | **UNVERIFIED** | No `GEMINI_API_KEY`. Adapter config and error mapping checked against google-genai 2.32.0. `scripts/provider_smoke.py` runs the live check once a key exists. Local Ollama was used for every measured result. |

## Engineering

| Item | Status |
|---|---|
| Backend tests (offline) | **PASS**: 68 passing (`cd backend && .venv/bin/pytest`) |
| UI smoke tests | **PASS**: 4 Playwright tests against the live server (incl. phone-width overflow); 2 scripted organiser walkthroughs on live data |
| CI | **PASS**: GitHub Actions green from commit `7b86116` (backend tests and frontend build) |
| Secrets | `.env` git-ignored; `.env.example` placeholders only. Staged diffs scanned before each commit. |

## Organiser-only items the repository cannot verify

- Submission portal format, deadlines, team registration and required file types.
- Whether synthetic demo transcripts are acceptable in place of real recordings. They
  are **not** a substitute for requirement 11.
- Slide-deck template, video length or format rules, and any live-demo hardware constraints.
- Consent forms or ethics approval for recording participants.
