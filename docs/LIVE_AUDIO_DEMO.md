# Live audio demo

A repeatable route for showing live transcription to judges: record in the browser,
transcribe on this laptop, read and correct the words, then analyse and download the report.
Every number below was measured on the demo laptop (Intel Core i9-9980HK, 16 threads, no
GPU acceleration for the models). Where something has not been verified, it says so.

## 1. Start

For the presentation, use the **demo workspace**: four clearly labelled synthetic meetings,
separate from the working database (`backend/data` is never touched).

```bash
backend/.venv/bin/python scripts/demo_workspace.py reset    # fresh copy; the previous one is kept as a backup
backend/.venv/bin/python scripts/demo_workspace.py serve    # http://127.0.0.1:8000
backend/.venv/bin/python scripts/demo_workspace.py verify   # 12 read-only checks of the story
```

To use the working database instead: `cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`.

The server reads `.env` (organiser token, model settings) and loads the local Whisper model
in the background at start (about 4 s), so the first recording does not wait for it.
Ollama must be running with `qwen3:8b` for the analysis step (`ollama serve`; check with
`ollama list`).

Open **http://127.0.0.1:8000** in the presentation browser and sign in with the
`ORGANIZER_TOKEN` from `.env`. The intro plays once per browser session; a refresh does not
replay it; open `/?present=1` to play it again. Esc or *Skip intro* leaves it.

## 2. Preflight (five minutes before)

1. **More → Diagnostics.** *Speech and integrations → Active* must say `whisper` (or
   `sarvam` if a key is configured). *Language model → Active* must say `ollama / qwen3:8b`.
   Press *Run live test* once; it should pass.
2. **Microphone permission, once per browser.** macOS: System Settings → Privacy & Security →
   Microphone → allow the browser (Safari or Firefox on this laptop). In the browser, allow
   the microphone for `127.0.0.1` when asked. `127.0.0.1` counts as a secure origin, so the
   browser allows recording without HTTPS.
3. **One rehearsal recording** of 10–20 seconds, end to end (record → transcribe). This also
   confirms the right input device is selected (the MacBook Pro microphone, not an iPhone or
   Teams virtual device: check the browser's site settings if the meter stays flat).
4. Keep a **fallback file** ready: a short recording you made yourself with consent, or the
   synthetic clip `demo/audio/synthetic_tts_meeting.m4a` (made by `scripts/make_tts_sample.sh`;
   synthetic, say so).

Credentials: Sarvam and Gemini keys are **not configured** on this laptop. Speech-to-text is
local Whisper (`faster-whisper-small`), the language model is local Ollama. Keys are read from
`.env` only and never shown in the UI or logs.

## 3. The demonstration

| Step | What to do | What the audience sees |
|---|---|---|
| 1 | *Record or upload a meeting* (Overview) | New meeting, with **Record audio** selected |
| 2 | *Record*; speak 10–25 s, e.g. “Rahul, please finish the refund API by Thursday. Priya will run the regression tests once it is merged. We decided to keep Stripe, because switching would delay the release.” | Elapsed time and a level meter that moves with the voice (measured input, not an animation) |
| 3 | *Stop*, then *Play* | The recording plays back from the browser; nothing has been uploaded |
| 4 | Tick consent, press *Transcribe recording* | Five-stage timeline: Audio received → Transcription (running, with elapsed time) |
| 5 | Wait a few seconds | **Transcript ready**: the recognised words with segment times, the recording player, and the note that local Whisper does not separate speakers |
| 6 | *Correct* one line, *Save correction* | The line is marked “corrected”; the server keeps both versions |
| 7 | *Analyze meeting* | Extracting decisions and actions (running), then Preparing meeting results |
| 8 | When it finishes | Results: summary, discussions, decisions, action items, questions; *Review and approve tasks* |
| 9 | *Download meeting report* (or *Preview report*) | The A4 PDF, marked DRAFT: PENDING APPROVAL until approved |

If the analysis is still running when time is short, say that the transcript on screen is the
live result, then open *Open a sample processed earlier* (shown on the processing screen). It
is a separate synthetic meeting analysed before the session; the page says it is not the
result of the live recording.

## 4. Measured on this laptop

| Measurement | Result | How |
|---|---|---|
| Browser recording pipeline (Chromium `getUserMedia` → `MediaRecorder` → upload → Whisper), 12 s of speech | transcript visible **6.5–6.6 s** after *Transcribe recording* (3 runs; includes the model load, which the real server does at start) | `e2e/flows/live-audio.spec.ts`, fake capture device playing a macOS TTS WAV |
| Server transcription, 14.7 s clip, model already loaded | **4.6–5.0 s** (`faster-whisper-small`); `base` took 1.7 s | direct benchmark |
| Upload + transcription of Safari (AAC `.m4a`), Firefox (Opus `.ogg`) and Chrome (Opus `.webm`) style files, 14.7 s | **4.8 s** each, all three transcribed correctly | sandbox server |
| Full analysis after transcription (interpret + minutes, Ollama `qwen3:8b`), 4-line transcript | **78.6 s** since Round 2 (the minutes are written alongside the interpretation; it was 139.2 s one after the other), same result: the decision “Stripe will remain the payment provider”, “Finish the refund API” (Rahul, Thu 29 Oct) proposed and “Run regression tests” (Priya) held for a question. Judge rehearsal: 70.8 s | sandbox server |
| PDF report (3 pages) | **0.36–0.65 s** to render | headless Chromium |

## 5. What is and is not verified

- **Verified:** recording, playback and upload through the real browser APIs (Chromium);
  transcription by local Whisper; transcript shown before any model call; correction stored as
  a new revision; analysis on request; analysis failure keeps the transcript; report PDF.
- **Not verified by the developers: a human speaking into this laptop's microphone.** macOS did
  not grant the developer tools microphone access, and no browser on this laptop could be
  automated with the real microphone. Steps 2–3 of the preflight are that check: do them before
  the session.
- **Not verified:** Safari and Firefox recording in an automated test (their recording formats
  were checked on the server side only); Sarvam (no key), so **speaker diarization is not
  available**: local Whisper labels every line `SPEAKER_00`, and the organiser names speakers.
  Sarvam's short-audio REST API has no diarization; diarization needs its Batch API, which is
  implemented (`services/speech/sarvam.py`) but has never run live.

## 6. If something fails

| Symptom | Fix |
|---|---|
| “Microphone access was denied” | Allow the microphone in the browser's site settings and in macOS Privacy & Security, reload, press *Record* again |
| Meter stays flat | Wrong input device: choose the MacBook Pro microphone in the browser's site settings (or System Settings → Sound → Input) |
| “No speech recognised” | The recording was silent: check the device, record again |
| “No speech-to-text provider” on New meeting | Local Whisper is not installed: `cd backend && uv sync --group local-stt`; or use *Upload transcript* |
| “Transcription complete; AI analysis unavailable.” | Ollama is not running: `ollama serve`, then *Retry analysis* (the recording is not transcribed again) |
| The analysis is too slow for the slot | Show the live transcript, then the labelled earlier sample |
| The browser cannot record | Use *Upload recording* with the fallback file |
