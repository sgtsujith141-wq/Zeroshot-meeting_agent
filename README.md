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
> - Gemini and Sarvam adapters are implemented but **unverified (no API keys)**.
> - The official **three-real-meeting evaluation has not been done** (no recordings yet).
> - The demo meetings are clearly labelled **synthetic** transcripts.
>
> Details are in [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md).

## Quick start

Requirements: Python 3.12, Node 20+, FFmpeg, and either a Gemini API key or a local
[Ollama](https://ollama.com) with `qwen3:8b` pulled (`ollama pull qwen3:8b`).

```bash
# 1. Configuration: creates a git-ignored .env with a random ORGANIZER_TOKEN
./scripts/setup_env.sh
#    Optional: add GEMINI_API_KEY and SARVAM_API_KEY to .env (never commit it)

# 2. Backend (Python 3.12 via uv)
cd backend && uv sync && cd ..

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

1. **Add a meeting.** Confirm consent and upload a transcript (`demo/*.json`, `.txt`,
   `.vtt`, `.srt`) or a recording (needs `SARVAM_API_KEY`). Or use the CLI:
   `backend/.venv/bin/python scripts/api.py ingest demo/synthetic_meeting_1_planning.json`
2. **Review changes.** Answer the ranked questions. For example, "Who is SPEAKER_03?"
   is answered by mapping the speaker, which re-checks everything without a model call.
   Then edit or exclude items and approve. Approval is pinned to exactly what you
   reviewed.
3. **Task board.** See the approved tasks, blocked ones waiting for prerequisites, and
   provenance and revision history in the task drawer.
4. **Later meeting.** Ingest `demo/synthetic_meeting_2_followup.json`. The review shows
   **before → after patches to the existing tasks**, and asks before cancelling
   anything ambiguous.
5. **Calendar & reminders**, **Next agenda**, **Ask past meetings** (grounded answers
   with citations), and **Diagnostics** (live services, evaluation runs).

The full talk track is in [`docs/demo-script.md`](docs/demo-script.md).

## Tests and evaluation

```bash
cd backend && .venv/bin/pytest -q          # 66 offline tests: fold, dates, identity, API flows, metrics
cd frontend && E2E_TOKEN=<token> npx playwright test   # UI smoke tests against a running server
backend/.venv/bin/python evaluation/run_eval.py --provider ollama --model qwen3:8b   # fixture experiment
backend/.venv/bin/python evaluation/real_eval.py report evaluation/private/*         # official metrics (real data)
```

- API integration tests use recorded LLM JSON (provider `test-fixture`). They test the
  workflow, not the model.
- Model quality is measured only by the evaluation runs in `evaluation/results/`.
- CI (GitHub Actions) runs the offline tests and the frontend build.

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
| `SARVAM_API_KEY`, `SARVAM_STT_MODEL`, `SARVAM_STT_MODE`, `SARVAM_LANGUAGE_CODE` | Sarvam batch STT (`saaras:v4`, `codemix`). |
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
