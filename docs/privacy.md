# Privacy, consent and security

This is a **single-organiser local prototype**. It is not a multi-user or enterprise
product. Everything below states only what is implemented.

## Consent

- A meeting cannot be created unless the organiser attests that every participant
  consented to recording and processing. The API rejects `consent_confirmed=false`
  with 422.
- The web form shows which services receive data before the box can be ticked.
- The attestation, its time and the organiser are stored on the meeting.
- Participants' consent itself is not collected or verified by the software. It is the
  organiser's responsibility.
- Recordings of real people must not be committed to git. The `.gitignore` excludes
  audio/video, databases, uploads and `evaluation/private/`.

## Where data goes

| Data | Destination | When |
|---|---|---|
| Audio/video | Sarvam AI batch STT (third party, India) | Only when `SARVAM_API_KEY` is set and a recording is processed. |
| Transcript text, speaker names, existing task titles/owners | The configured LLM. **Google Gemini** (third party) if `GEMINI_API_KEY` is set; otherwise a **local Ollama** model on the same machine (nothing leaves the machine). | When a meeting is analysed or memory Q&A uses the model. |
| Everything else | Local SQLite `backend/data/app.db` and `backend/data/uploads/` | Always. |

The Diagnostics page shows which provider is active.

Transcript uploads are parsed into segments, and the raw upload file is not kept.
Audio/video files are stored in `backend/data/uploads/meeting-<id>/` under a
server-generated random name, outside any public directory. They are served only via
a short-lived HMAC-signed URL.

## Controls that are implemented

- **Auth:** every endpoint except `/api/health` requires `Authorization: Bearer
  <ORGANIZER_TOKEN>`, checked with a constant-time compare. If the token is not
  configured, the server refuses all protected requests (503). The browser keeps the
  token in `sessionStorage` for that tab only. It is never in the built bundle.
- **Human approval:**
  - No task, task change, calendar entry or reminder exists before an approval that
    carries the hash of exactly what was reviewed.
  - Summaries are *prepared*, then *approved* with explicit recipients, and *sent*
    only if SMTP is configured. Otherwise the UI and API say "approved but NOT sent".
  - Email reminders need an approval and SMTP.
  - No third-party calendar is written; `.ics` is a download.
- **Prompt injection:**
  - Transcript text is wrapped as data, and the prompts say it is untrusted.
  - The model's output can only be typed events; there is no tool-calling.
  - Segments addressing the assistant or asking to bypass review are flagged, and items
    based only on them are held.
  - Memory answers must cite retrieved passages, or they are replaced with "not found
    in stored meetings".
- **Uploads:**
  - Extension allow-list.
  - Size limits: transcripts 2 MB; media `MAX_UPLOAD_MB`, default 200.
  - `ffprobe` must find an audio stream.
  - FFmpeg is invoked with argument lists and timeouts, never through a shell.
  - Filenames are sanitised for display only; the storage path is server-chosen, so path
    traversal is not possible.
- **API validation:** Pydantic models check timezones, ISO dates, enum choices, lengths
  and patterns. Clarification answers are checked against a per-kind allow-list.
- **CORS** is restricted to the configured origins. Security headers are set:
  `nosniff`, `DENY` framing, `no-referrer`, and `no-store` for the API.
- **Logging:** operational logs and audit lines carry identifiers and actions, not
  transcript text or secrets. The audit table records actor, object, action,
  before/after and a UTC time.
- **Deletion:** `DELETE /api/meetings/{id}` removes the transcript, events, minutes,
  unapproved change sets, uploaded media and memory index rows. It refuses while
  approved tasks reference the meeting, so as not to orphan the board.

## Not implemented (do not claim)

- User accounts, roles, per-user permissions, multi-tenancy, SSO.
- Encryption at rest. SQLite and uploads are plain files; use disk encryption.
- Automatic retention or expiry of meetings.
- Verified participant consent capture, and voice-print identity.
- Any real Google/Outlook calendar sync, chat integration, or verified email delivery
  (no SMTP server was configured during development).
- Rate limiting.

## Failure boundaries

- **LLM unavailable or returns invalid JSON (after one repair retry):** the meeting is
  marked `failed` with the reason. Earlier events, minutes and change sets are kept.
  Transcript import still works.
- **Sarvam unavailable:** recordings fail with a clear reason, and transcripts can be
  imported instead.
- **Backend restarted mid-job:** the meeting is marked "interrupted" on the next start,
  not left as "processing".
- **Reminders** fire only while the backend process runs. Missed reminders fire on the
  next poll after restart, and the delivery state is recorded.
