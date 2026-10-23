# Round 2, pass 1: functional reliability

Goal: nothing breaks on the core demo path. Started from `9696250` (main, CI green).
Safety branch before Round 2 changes: `safety/pre-round2-9696250`.

## What was inspected

The running app (live server and disposable sandboxes), every route at 1440 and 390 px, the
recording flow, uploads, processing, the transcript, analysis, results, approvals, tasks,
Ask AI and the report; the backend endpoints those controls call; the existing pytest and
Playwright coverage. The full inventory, with the test for each control, is
[`ROUND2_CONTROL_AUDIT.md`](ROUND2_CONTROL_AUDIT.md).

## Findings and fixes

| # | Finding | Severity | Fix | Verified by |
|---|---|---|---|---|
| F1 | The presentation intro replayed on every reload, so a presenter could not refresh a broken page without the intro | P0 | Plays on the first load of a browser session and whenever the address has `?present=1`; Esc, Skip intro and Enter workspace record that it was seen | `final-ui.spec.ts` intro tests (first load, refresh, `?present=1`) |
| F2 | "Copy and mark approved" did not wait for the clipboard: a refused copy was still recorded as approved | P0 | The copy is awaited; on failure nothing is approved and the page says "Nothing was copied, so the summary was not marked approved" | new `meetings.spec.ts` test (clipboard refuses → no approve request, state stays "prepared") |
| F3 | The live demo database contained duplicate tasks (TASK-5/6) from a hand-approved "TEST" meeting | P0 | A separate, resettable **demo workspace** (`demo/workspace.sql`, `scripts/demo_workspace.py reset / serve / verify`), served on :8000. The working database `backend/data` is untouched | `demo_workspace.py verify`: 12/12 checks (synthetic labels, no duplicates, Priya → Samiksha on TASK-2, dependency cleared, only meetings 1–2 approved, Ask answers, four reports) |
| F4 | An empty workspace offered only one generic button | P1 | Three actions: Record your first meeting, Upload a transcript, Try a synthetic sample (attached and labelled SYNTHETIC; nothing is created until submitted) | `shell.spec.ts` and `links.spec.ts` empty-database tests |
| F5 | No test for a refused microphone | P1 | Added; also found that a browser which cannot prompt returns `NotSupportedError`, which was reported as a generic error. It is now "This browser cannot record audio on this page…" with the upload as the way forward | `mic-denied.spec.ts` (3 tests) |
| F6 | No test for video uploads | P1 | Added: a video with sound is stored as video and its audio is transcribed; a video without sound is refused with the reason | backend `test_transcribe_first.py` |
| F7 | No test for "Try transcription again" | P2 | Added: a provider failure keeps the recording; retry transcribes it | backend `test_transcribe_first.py` |
| F8 | No test for Re-record and Preview report | P2 | Added | `mic-denied.spec.ts`, `final-ui.spec.ts` |

Verified unchanged (existing tests, rerun): stale-proposal re-check (409 then recover),
duplicate approval, answers while saving, delete refusal, re-run refusal for approved
meetings, provider failure keeping the transcript, the processing view's real stages.

## Physical microphone

**BLOCKED for the developers.** macOS refuses microphone access to the developer tools
("Cannot use MacBook Pro Microphone"). The browser path is verified with Chromium's capture
device playing recorded speech (`live-audio.spec.ts`). Operator action, about a minute
(`LIVE_AUDIO_DEMO.md` §2): allow the browser in System Settings → Privacy & Security →
Microphone, open http://127.0.0.1:8000, New meeting → Record, speak 10–20 s, Stop, Play,
tick consent, Transcribe recording, and check the words. The MacBook Pro microphone must be
the input (an iPhone and a Teams virtual device are also present on this laptop).

## Test runs after pass 1

See the pass 4 report for the final full runs; the runs here gate the pass.

| Command | Input | Result |
|---|---|---|
| `cd backend && .venv/bin/pytest -o addopts=""` | offline, recorded LLM JSON; real Whisper where installed | 132 passed, 0 failed, 0 skipped |
| `cd frontend && npx playwright test e2e/flows --grep-invert "upload → processing|ask with the model|model is down|diagnostics live test"` | disposable sandboxes; Chromium; synthetic data and synthetic speech | 104 passed, 0 failed (6.9 min); then the 2 tests added afterwards (Re-record, Preview) passed on their own |
| `python scripts/demo_workspace.py verify` | live demo workspace on :8000 | 12 passed, 0 failed |
