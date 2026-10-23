# Meeting-to-Action Tracker Agent (PS 5.3)

VIT Zero Shot Hack 2026, Track 5 (GenAI & Agentic Intelligence), problem statement 5.3.

The app turns meeting recordings or transcripts into **reviewed, tracked commitments**:
minutes, decisions with reasons, and actions with owner, due date, priority and
dependencies. Every one is tied to the words that support it. Nothing becomes a task
until the organiser approves it. Later meetings **update the existing tasks** instead of
duplicating them.

The differentiator is a **commitment reconciliation engine**:
- The language model only describes what was said, as ordered, typed events
  (propose, confirm, reassign, change deadline, cancel…).
- Deterministic code folds those events into the current state of the work, checks them
  against the task board, and asks the organiser the fewest questions needed when it
  can't act safely.
- See [`docs/architecture.md`](docs/architecture.md).

> **Honest status**, as of the last commit:
> - Live LLM verified with a **local Ollama model (qwen3:8b)**.
> - Audio upload verified through the UI with a **local Whisper** fallback (no diarization),
>   on a synthetic TTS clip.
> - Gemini and Sarvam adapters are implemented and checked against their SDKs, but
>   **unverified live (no API keys)**.
> - The official **three-real-meeting evaluation is NOT MEASURED** (no recordings yet).
> - Demo meetings are clearly labelled **synthetic**.
>
> Details are in [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md).

## Quick start

Requirements: Python 3.12, Node 20+, FFmpeg, and either a Gemini API key or a local
[Ollama](https://ollama.com) with `qwen3:8b` pulled (`ollama pull qwen3:8b`).

```bash
# 1. Configuration: creates a git-ignored .env with a random ORGANIZER_TOKEN
./scripts/setup_env.sh
#    Optional: add GEMINI_API_KEY and SARVAM_API_KEY to .env (never commit it)

# 2. Backend (Python 3.12 via uv). Add --group local-stt for the local Whisper fallback
cd backend && uv sync --group local-stt && cd ..

# 3. Frontend build (served by the backend)
cd frontend && npm ci && npm run build && cd ..

# 4. Run: API + web UI + reminder worker on http://127.0.0.1:8000
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 and sign in with the `ORGANIZER_TOKEN` from `.env`. The
schema is created automatically on first start (SQLite at `backend/data/app.db`). No
migrations need to be run, and existing data is never dropped.

Frontend development with hot reload: `cd frontend && npm run dev`, then open
http://localhost:5173 (`/api` is proxied to :8000).

The reminder worker runs inside the backend process, polling every
`REMINDER_POLL_SECONDS`. It only works while the backend runs.

## Using it (about 3-minute demo path)

0. **Presenting?** Open http://127.0.0.1:8000/?present=1 for a short intro; Esc skips it.
   It never appears otherwise.
1. **Your workspace** lists what needs review, upcoming tasks and recent meetings.
2. **New meeting.** Confirm consent and upload a transcript (`demo/*.json`, `.txt`,
   `.vtt`, `.srt`) or a recording (needs `SARVAM_API_KEY`, or the optional local Whisper),
   or choose *Use the synthetic demo transcript*. *Analyze meeting* uploads and starts
   processing; the meeting page shows each real processing stage as it finishes. Or use the CLI:
   `backend/.venv/bin/python scripts/api.py ingest demo/synthetic_meeting_1_planning.json`
3. **Results.** Summary, key discussions, decisions, action items and questions to
   clarify, each linked to the transcript lines it came from.
4. **Approvals.** Every proposed change reads as before → after, computed by the same
   rules approval applies. Answer the questions (for example, "Who is SPEAKER_03?" is
   answered by mapping the speaker, which re-checks everything without a model call),
   open a row for its evidence and history, edit or exclude items, then approve. After
   every action the page lists what changed. Approval is pinned to exactly what you reviewed.
5. **Tasks.** The approved tasks as a list (or a board), with dependencies, and
   provenance and revision history in the task drawer.
6. **Later meeting.** Ingest `demo/synthetic_meeting_2_followup.json`. The approval shows
   **before → after changes to the existing tasks**, and asks before cancelling anything
   ambiguous.
7. **Ask AI.** Owner, deadline, pending, blocked and "what is X working on" questions are
   answered straight from the approved task records, without a model call. Other
   questions get grounded answers with citations; matching passages show while the model
   writes. Each answer shows its measured time.
8. **Follow-ups** (next-meeting agenda, calendar export, reminders, notifications) and
   **Diagnostics** in the More menu (live services, evaluation runs).

The full talk track is in [`docs/demo-script.md`](docs/demo-script.md).

## Tests and evaluation

```bash
cd backend && .venv/bin/pytest -q          # offline tests: fold, dates, identity, API flows, providers, metrics
cd frontend && npx playwright test e2e/flows --grep-invert "upload → processing|ask with the model|model is down|diagnostics live test"
                                           # 99 browser tests incl. accessibility, on disposable sandboxes (about 5 min)
cd frontend && npx playwright test e2e/flows/slow.spec.ts   # 4 live-model flows (Ollama; about 7 min)
cd frontend && E2E_TOKEN=<token> npx playwright test e2e/smoke.spec.ts   # read-only checks of a running server
cd frontend && SCREENS=1 VW=390 npx playwright test e2e/screens.spec.ts  # viewport screenshots + overflow/clipping checks
backend/.venv/bin/python evaluation/run_eval.py --provider ollama --model qwen3:8b   # fixture experiment
backend/.venv/bin/python evaluation/run_eval.py --fixtures evaluation/fixtures/holdout_v2.json \
    --keys evaluation/annotations/holdout_v2_match_keys.json                         # fresh holdout
backend/.venv/bin/python scripts/provider_smoke.py --audio <recording>               # live Gemini/Ollama/STT check
backend/.venv/bin/python evaluation/real_eval.py init|export|report ...              # official metrics (real data)
```

- API integration tests use recorded LLM JSON (provider `test-fixture`). They test the
  workflow, not the model.
- Browser tests (`frontend/e2e/flows`) start their own backend per test, with a copy of the
  demo data (or an empty database) and a random token. They never touch the demo server or
  its data, and they fail on any page error, console error or unexpected API error.
  - They need `backend/.venv` and a processed demo database. A pinned copy in
    `frontend/e2e/.demo-snapshot/` (git-ignored) is used when present.
  - Every control and its result are listed in
    [`docs/UX_FUNCTIONAL_AUDIT.md`](docs/UX_FUNCTIONAL_AUDIT.md).
- Model quality is measured only by the evaluation runs in `evaluation/results/`.
- CI (GitHub Actions) runs the offline tests and the frontend build. The browser tests need the local demo data and model, so they run locally.

**Synthetic fixture results** (12 cases; same model per run; pre-registered rubric):

| model | strict F1, baseline / + date rules / **engine** | safety checks, baseline / **engine** |
|---|---|---|
| qwen3:8b | 0.35 / 0.70 / **0.82** | 5/8 / **8/8** |
| llama3.1:8b | 0.72 / 0.80 / **0.90** | 4/8 / **8/8** |

The engine was weaker at dependency recall on llama3.1. That, the post-hoc fixes, and
what these synthetic numbers do *not* show are covered in
[`docs/evaluation.md`](docs/evaluation.md).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `ORGANIZER_TOKEN` | Required. Bearer token for every API call except `/api/health`. |
| `LLM_PROVIDER` | `auto` (Gemini if a key exists, else Ollama), `gemini` or `ollama`. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini via `google-genai` (default `gemini-3.8-flash`). |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX` | Local model (default `qwen3:8b`). |
| `LLM_TEMPERATURE`, `LLM_SEED`, `LLM_TIMEOUT_SECONDS` | Generation settings (0, 7, 600). |
| `STT_PROVIDER`, `WHISPER_MODEL`, `WHISPER_LANGUAGE` | `auto` (Sarvam if a key exists, else local Whisper if installed), `sarvam` or `whisper`. |
| `SARVAM_API_KEY`, `SARVAM_STT_MODEL`, `SARVAM_STT_MODE`, `SARVAM_LANGUAGE_CODE` | Sarvam batch STT (`saaras:v4`, `codemix`, diarization). |
| `DATA_DIR`, `MAX_UPLOAD_MB`, `CORS_ORIGINS`, `DEFAULT_TIMEZONE`, `REMINDER_POLL_SECONDS` | Storage and server. |
| `SMTP_*` | Optional. Without it, nothing is ever emailed. |

## Repository map

```
backend/app/        FastAPI app: api/, services/ (reconcile, dates, identity, changesets,
                    processing, llm/, speech/, memory, reminders, calendar, agenda, summary)
backend/tests/      pytest (offline)
frontend/src/       React UI; frontend/e2e/ Playwright
evaluation/         run_eval.py, real_eval.py, RUBRIC.md, fixtures/, annotations/, results/
demo/               SYNTHETIC demo transcripts (labelled; not real meetings)
docs/               architecture, api, privacy, evaluation, demo-script, judge-qa, limitations
scripts/            setup_env.sh, api.py (CLI)
ZeroShot_PS53_Claude_Starter_Kit/   the original brief and fixtures
```

## Documentation

- [Architecture and design rules](docs/architecture.md)
- [API reference](docs/api.md)
- [Privacy, consent and security](docs/privacy.md)
- [Evaluation methodology and results](docs/evaluation.md)
- [Known limitations](docs/limitations.md)
- [Demo script (5–7 min)](docs/demo-script.md)
- [Judge Q&A](docs/judge-qa.md)
- [Submission checklist](SUBMISSION_CHECKLIST.md)
