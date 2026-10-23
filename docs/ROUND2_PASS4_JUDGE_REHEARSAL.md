# Round 2, pass 4: adversarial judge rehearsal

Goal: find what could embarrass us in front of judges, from a fresh browser session. Each
scenario is an executable browser test that checks the screen and the server's records:
`frontend/e2e/judge/rehearsal.spec.ts` (C–G, demo data, no model) and
`frontend/e2e/judge/live.spec.ts` (A and B, local Whisper and Ollama).

## Scenarios

| | Scenario | How | Result |
|---|---|---|---|
| A | Record → stop → play → transcribe → check words → correct a line → analyse → summary → report | Chromium capture device playing a 13 s macOS TTS sentence; real Whisper; real Ollama `qwen3:8b` | **PASS** (2 runs): transcript on screen 8.4 s after *Transcribe recording* both times (sandbox, model not pre-loaded); analysis 70.8 s and 94.7 s; proposals "Finish the refund API" (Rahul) and "Run the regression tests" (Priya, held: "by Friday" said on a Friday is ambiguous); report PDF says DRAFT: PENDING APPROVAL and names whisper-local |
| A′ | The same with a person speaking into this laptop's microphone | — | **BLOCKED**: macOS denies microphone access to the developer tools. Operator check in `LIVE_AUDIO_DEMO.md` §2 |
| B | Two voices in one recording | Two macOS voices, uploaded; local Whisper | **PASS** for honesty: one label (SPEAKER_00), the "speaker separation is not available" notice shown, no invented speaker IDs. **Diarization itself BLOCKED** (no Sarvam key) |
| C | Reassignment across meetings | Meeting 1 shows Priya; meeting 2's approval shows Owner Priya → Samiksha on TASK-2; the API has one regression-test task; the drawer shows revisions 1 and 2 | **PASS** |
| D | Approval safety | Approve with open questions (button disabled; forced API call 409); stale proposal (409, re-check, approve); repeat approval (idempotent, one new task); four operations without the token (401) | **PASS** |
| E | Ask AI | "Who currently owns testing and when is it due?" from the task records; the source opens the transcript at s3; an unsupported question gives "Nothing found in stored meetings" | **PASS** after fix R1 below. The "why" question with the model: see pass 2 (grounded answer citing s5, 31.8 s) |
| F | Report | Download; pdftotext finds the title, APPROVED, the start of the stored summary, both tasks and Samiksha; more than one page with "Page N of N"; a pending meeting's report says DRAFT and never "(approved)" | **PASS** |
| G | Failure recovery | Refresh while processing (same live stages, transcript visible, no blank page); microphone refused; invalid file; model unreachable; retry analysis | **PASS** (refresh here; the others in `mic-denied`, `meetings`, `final-ui` and the backend tests) |

## Found and fixed in this pass

| # | Finding | Fix |
|---|---|---|
| R1 | "Who currently owns testing and when is it due?", the demo's own question, went to the slow model path: "testing" names only one of the three words of "Run regression tests", below the match threshold, and "currently" counted as a task word | A task also matches when every content word of the question appears in its title (ranking still by title share, so ambiguous questions still ask "Which task do you mean?"); "currently", "now" and similar are ignored. Regression test in `test_task_answers.py`; answered in 20 ms in the UI |
| R2 | The Ask box showed two focus rings: the page-wide focus style was unlayered CSS, which beats the component's own utilities | The page-wide focus style moved into Tailwind's base layer; keyboard focus stays visible everywhere (accessibility and keyboard specs rerun) |

## Final visual review

Viewport screenshots of the demo workspace (1440 × 900 and 390 × 844) are in `docs/round2/`;
`screens.spec.ts` checked every route at 1440, 1024 and 390 px for horizontal overflow and
controls outside the viewport; axe (WCAG 2.1 A/AA) ran on every route in both themes, the
drawers, dialogs and the intro.

## Final test runs

| Command | Environment | Input | Pass | Fail | Skip |
|---|---|---|---|---|---|
| `cd backend && .venv/bin/pytest -o addopts=""` | macOS, Python 3.12 | recorded LLM JSON; real Whisper, FFmpeg, Chromium where present | 133 | 0 | 0 |
| `cd frontend && npx tsc -p tsconfig.app.json --noEmit` | Node 24 | source | exit 0 | — | — |
| `cd frontend && npx playwright test e2e/flows --grep-invert "upload → processing\|ask with the model\|model is down\|diagnostics live test"` | headless Chromium, disposable sandboxes | synthetic demo data; synthetic speech through the capture device; real Whisper | 105 | 0 | 0 |
| `cd frontend && npx playwright test e2e/flows/slow.spec.ts` | + live Ollama `qwen3:8b` | synthetic transcripts | 4 | 0 | 0 |
| `cd frontend && npx playwright test e2e/judge` | + live Whisper and Ollama | demo data; synthetic speech | 7 | 0 | 0 |
| `SCREENS=1 VW=1440\|1024\|390 [THEME=dark] npx playwright test e2e/screens.spec.ts` | headless Chromium | every route | 4 runs | 0 | 0 |
| `E2E_TOKEN=… npx playwright test e2e/smoke.spec.ts` | the live demo server | demo workspace, read-only | 4 | 0 | 0 |
| `python scripts/demo_workspace.py verify` | the live demo server | demo workspace, read-only | 12 checks | 0 | 0 |
| Accessibility: axe WCAG 2.1 A/AA in `a11y.spec.ts` (every route, both themes, drawers, dialogs, intro) | included in the fast suite | | 0 violations | | |

Not run because the dependency is missing (reported as BLOCKED, not PASS): a person speaking into
the demo laptop's microphone; Sarvam diarization; Gemini; email delivery (no SMTP).
