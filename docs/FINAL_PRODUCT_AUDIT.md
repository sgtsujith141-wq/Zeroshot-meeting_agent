# Final product audit

Meeting Actions (VIT Zero Shot Hack 2026, PS 5.3), 23 October 2026. Every result below was
measured on the demo laptop (Intel Core i9-9980HK, 16 threads, macOS) unless marked otherwise.
Anything not verified is labelled NOT VERIFIED, BLOCKED or NOT MEASURED.

## 1. Executive summary

- **Live recording works in the browser and is transcribed on this laptop.** Record audio in
  New meeting uses the browser's microphone APIs, shows the measured input level, plays the
  take back, and uploads only on *Transcribe recording*. Local Whisper returns the words in
  about 5 s for a 15 s clip, and the transcript is shown at once, before any language model
  runs. The organiser can correct lines, then start the analysis.
- **The real hardware microphone is the one thing the developers could not test**: macOS
  refused microphone access to the developer tools. The browser pipeline was verified with
  Chromium's capture device playing recorded speech. A one-minute check by the presenter
  (docs/LIVE_AUDIO_DEMO.md, preflight) closes this.
- **Speaker diarization is BLOCKED**: it needs Sarvam (no key on this laptop). Local Whisper
  labels every line SPEAKER_00, and the UI and the report say so.
- **A professional A4 PDF report** is generated from the stored records for any meeting with a
  transcript (0.35–0.7 s), with approval state, action register, changes to earlier
  commitments, outstanding questions, follow-up and transcript, in Hindi and Kannada too.
- **The UI was redesigned** (limestone, forest graphite, vermilion) with the new recording,
  processing and report screens; all approval and reconciliation rules are unchanged.
- **The official evaluation on three real meetings is NOT MEASURED** (no recordings received).

## 2. Code state

- Repository: https://github.com/sgtsujith141-wq/Zeroshot-meeting_agent
- Branch `live-audio`, fast-forwarded into `main`. Latest code commit before this document: `71bd11d`; this document is in the commit that follows it (`git log -1 -- docs/FINAL_PRODUCT_AUDIT.md`).
- Safety branch before this work: `safety/pre-live-audio-bd9bbe3` (main was `bd9bbe3`).

## 3. Architecture (what changed)

```
Browser (React)                         FastAPI backend                         Local services
Record audio ── MediaRecorder ──▶ POST /meetings/{id}/upload  ──▶ FFmpeg normalise ──▶ faster-whisper (small)
  (WebM/Opus, MP4/AAC, Ogg/Opus)      transcribe_only=true            │
                                       status: transcribed ◀───────────┘   transcript stored at once
Transcript ready ◀── GET /meetings/{id} (polled)
  correct a line ──▶ PATCH /segments/{key}   (new revision)
  Analyze meeting ──▶ POST /process {interpret, minutes} ──▶ Ollama qwen3:8b ──▶ rules ──▶ proposal
Results / report ──▶ GET /meetings/{id}/report.pdf ──▶ HTML from stored records ──▶ headless Chromium ──▶ A4 PDF
```

- **Transcript first.** `run_pipeline(steps=("transcribe",))` stops after speech-to-text
  with status `transcribed`. Each step commits on its own, so a later model failure never
  removes the transcript; `POST /process` with interpret+minutes retries without
  transcribing again.
- **Audio-only WebM** (what Chromium records) is stored as audio, not video (ffprobe check).
- **Whisper pre-load.** The model loads in a background thread at server start
  (`WHISPER_PREWARM=0` disables it).
- **Report.** `services/report.py` builds print-ready HTML from the database and renders it
  with headless Chromium (`--print-to-pdf`, CSS page margin boxes for running headers and
  page numbers). System fonts only: nothing is bundled. Endpoints: `GET /api/meetings/{id}/report.pdf`
  (`?download=1` for an attachment) and `report.html`, both organiser-only.

## 4. Speech provider configuration

| Provider | State on this laptop |
|---|---|
| Local Whisper (`faster-whisper-small`, CPU, int8) | **Active.** Installed and verified |
| Sarvam saaras:v4 Batch (diarization) | **BLOCKED**: `SARVAM_API_KEY` not set. Implemented, never run live |
| Sarvam short-audio REST API | Not implemented. It has no diarization; with no key to verify it, it was not added |
| Gemini (LLM) | Not configured (no key). The local Ollama `qwen3:8b` is the active model |

## 5. Live microphone test results

| Test | Result |
|---|---|
| Chromium: Record → level meter → Stop → Play → Transcribe → transcript → correction, real Whisper (`e2e/flows/live-audio.spec.ts`; capture device plays a 12 s TTS speech WAV) | **PASS**, 3 of 3 runs; transcript visible **6.5–6.6 s** after *Transcribe recording* (includes the model load; sandboxes do not pre-load) |
| Measured input level drives the meter (bars above the floor while speech plays) | **PASS** (same test) |
| Server accepts and transcribes what each browser records: Safari AAC `.m4a`, Firefox Opus `.ogg`, Chrome Opus `.webm` | **PASS**, 4.8 s each for 14.7 s, correct words |
| Silent recording | Shows "No speech recognised" (no invented text) |
| A person speaking into this laptop's built-in microphone | **BLOCKED for the developers**: macOS denied microphone access to the developer tools ("Cannot use MacBook Pro Microphone"). The presenter must run the preflight in docs/LIVE_AUDIO_DEMO.md |
| Safari / Firefox recording in an automated browser | NOT VERIFIED (no matching automation build); formats verified server-side only. Chrome and Edge are not installed on this laptop |

## 6. Multi-speaker status

**BLOCKED.** Diarization requires the Sarvam Batch API and a key. With local Whisper every
segment is `SPEAKER_00`; the New meeting page, the transcript panel and the report state that
speaker separation is not available. Speakers can be named afterwards (Speakers tab); a
label is never treated as a verified identity.

## 7. Audio and language limitations

- Timestamps are per Whisper segment, not per word.
- `faster-whisper-small` on code-mixed speech: on the synthetic TTS check, a Kannada line came
  out phonetically in Devanagari (docs/evaluation.md). Sarvam is the intended provider for
  code-mixed meetings.
- Recordings are limited to 30 minutes in the browser and to `MAX_UPLOAD_MB` (200 MB) on the server.
- The analysis with the local model takes minutes (below); only transcription is fast.

## 8. Screen-by-screen changes

| Screen | Change |
|---|---|
| Whole app | Limestone canvas `#F5F2EB`, white surfaces, deep ink text, forest graphite `#172D30` sidebar, vermilion `#C8583D` marks. Buttons and links use `#AB452E` and secondary text `#5A676E` so text meets WCAG AA (white on `#C8583D` is 4.27:1) |
| Intro | Palette only; plays on every load (presenter's request); Esc / Skip intro |
| Overview | "Meeting Actions — From meetings to work that gets done.", *Record or upload a meeting*; Meetings awaiting review (including transcripts waiting for analysis), Upcoming tasks, Recently processed meetings |
| New meeting | Record audio / Upload recording / Upload transcript; the recorder dominates in record mode; time zone under More options |
| Processing | Five stages from real status and log times: Audio received, Transcription, Transcript ready, Extracting decisions and actions, Preparing meeting results; transcript below as soon as it exists; Retry analysis; Try transcription again |
| Results | Summary, discussions, decisions, action items, questions; *Review and approve tasks*, *Download meeting report*, *Preview report* |
| Approvals, Tasks, Ask AI, Follow-ups | Restyled by the palette; behaviour unchanged from the previous release (before → after lines, compact task list, fast task answers) |

## 9. PDF report validation

| Case | Pages | Render | Checked |
|---|---|---|---|
| Approved meeting (demo meeting 1) | 3 | 0.35 s | APPROVED tag; tasks with board status "(approved)" |
| Cross-meeting changes (meeting 2) | 3 | 0.37 s | Owner Priya → Samiksha, due date added, "Yes" approved |
| Code-mixed, pending (meeting 3) | 3 | 0.39 s | DRAFT: PENDING APPROVAL; "Proposed, not approved" |
| Unresolved clarifications (meeting 4, audio) | 3 | 0.41 s | 4 open questions; Devanagari lines shaped; speaker-separation notice |
| Short English recording (a synthetic TTS clip uploaded as WebM; Whisper, then Ollama) | 3 | 0.39 s | summary, Stripe decision, two actions, one open question |
| Long transcript (192 segments, synthetic, not analysed) | 10 | 0.49 s | TRANSCRIPT ONLY; all 192 segments present (pdftotext); no empty first page |

Pages were rendered to images (pdftoppm) and inspected. Defects found and fixed during
inspection: running header missing the title; proposed actions coloured as approved; a
transcript-only report starting with an almost empty page; transcript-named speakers listed
as "not identified". `tests/test_report.py` checks the approval wording, escaping, Unicode,
access control, and (where Chromium and poppler exist) the PDF text against the records.

## 10. Test results

| Suite | Tests | Result |
|---|---|---|
| Backend `pytest` (incl. `test_transcribe_first.py` with real Whisper on a WebM, and `test_report.py` with a real PDF render read back by pdftotext) | 123 | **123 pass** |
| Browser suite `e2e/flows` without the 4 live-model tests, one clean run: navigation, approvals and reconciliation, questions, meetings, tasks, Ask AI, follow-ups, links, accessibility (axe, WCAG 2.1 A/AA, both themes, intro), final UI, **live recording** | 101 | **101 pass** (5.5 min) |
| Live-model suite `slow.spec.ts` (Ollama: upload → analysis → re-run → approve; grounded answer with passages shown while the model writes; model down; live test) | 4 | **4 pass** (5.0 min) |
| Screen checks `screens.spec.ts` (every route: no horizontal overflow, no control outside the viewport) at 1440, 1024, 390 px light and 1440, 390 px dark | 5 runs | **5 pass** |
| Read-only smoke tests against the live demo server | 4 | **4 pass** |
| Frontend production build; CI | — | passes; CI: see the push |

During this work one browser test failed once for a test-side reason: a second page opened with
`browser.newPage()` did not skip the intro. It was fixed and the whole suite then passed in
one run.

## 11. Performance (measured)

| Measurement | Result |
|---|---|
| Recording duration in the browser test | ~12 s of speech |
| Upload + transcription, 14.7 s clip (Safari/Firefox/Chrome formats) | 4.8 s each |
| Transcription only, 14.7 s, model loaded (`small`) | 4.6–5.0 s (`base`: 1.7 s, not adopted: weaker on accents and code-mix) |
| Whisper model load | 4.4 s (now done at server start) |
| Click *Transcribe recording* → words on screen (browser test, includes model load) | 6.5–6.6 s |
| Full analysis after transcription (4-line transcript, Ollama `qwen3:8b`) | 139.2 s (interpretation 74.6 s + minutes 64.0 s) |
| PDF render | 0.35–0.7 s; 3 pages typical, 10 pages for 192 segments |
| Ask AI, task-state question (from the previous release) | median 4.0 ms; model answers 18–40 s |

## 12. Remaining issues

- Hardware microphone with a human speaker: not verified by the developers (operator check).
- Diarization: needs a Sarvam key.
- The analysis with the local model takes about 2 minutes even for a short clip.
- Safari/Firefox recording not automated; Chrome/Edge not installed on the demo laptop.
- The live demo database contains duplicate tasks (TASK-5/6) from a hand-approved "TEST"
  meeting; it was left untouched.
- A screen-reader walkthrough was not done.

## 13. Known risks

- A browser or OS microphone permission prompt during the talk: do the preflight.
- Wrong input device (an iPhone or Teams virtual microphone is also present on this laptop).
- Ollama not running: the transcript still shows; the analysis fails with a clear message and
  can be retried.

## 14. Demonstration readiness

**NEEDS FIXES, one operator check.** Everything the developers could run passes. The live
judge demo depends on one thing they could not run: a person speaking into this laptop's
microphone in the presentation browser (Safari or Firefox; Chrome is not installed). The
preflight in docs/LIVE_AUDIO_DEMO.md takes about a minute (grant the microphone, record
10–20 s, see the words). Once it passes, the live route is ready, with the transcript in
seconds and the analysis in about 2 minutes, and the labelled earlier sample as the fallback.

## 15. Outstanding official submission requirements

- The evaluation on three real meetings: **NOT MEASURED** (no consented recordings received;
  procedure in `evaluation/real_eval.py`).
- Gemini, Sarvam and SMTP: **not verified live** (no keys or server).
- No release tag (`v1.0.0-zeroshot`) has been created, because the items above are open.
