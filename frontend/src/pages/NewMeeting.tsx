import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import type { MeetingSummary } from '../types'
import { Button, ErrorBox, Field, PageHeader, inputCls } from '../components/ui'

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore']

function localNow() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function NewMeeting() {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(localNow())
  const [tz, setTz] = useState('Asia/Kolkata')
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true); setError(null)
    try {
      const m = await api.post<MeetingSummary>('/api/meetings', {
        title, scheduled_at: when, timezone: tz, consent_confirmed: consent,
        consent_statement: 'Organiser confirmed in the web form that every participant consented to recording and processing, including by third-party AI providers.',
      })
      const form = new FormData()
      form.append('file', file)
      form.append('auto_process', 'true')
      await api.upload(`/api/meetings/${m.id}/upload`, form)
      nav(`/meetings/${m.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Add a meeting" sub="Upload a recording (audio or video) or an existing transcript. Nothing becomes a task until you approve it." />
      <form onSubmit={submit} className="max-w-2xl space-y-5">
        <ErrorBox error={error} />
        <Field label="Meeting title"><input className={inputCls} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date and time" hint="Relative deadlines like “by Friday” are resolved from this date.">
            <input type="datetime-local" className={inputCls} required value={when} onChange={e => setWhen(e.target.value)} />
          </Field>
          <Field label="Meeting time zone">
            <select className={inputCls} value={tz} onChange={e => setTz(e.target.value)}>{TIMEZONES.map(z => <option key={z}>{z}</option>)}</select>
          </Field>
        </div>
        <Field label="Recording or transcript" hint="Audio: wav, mp3, m4a, aac, ogg, flac, opus. Video: mp4, mov, mkv, webm. Transcript: json, txt (“Speaker: text” lines), vtt, srt.">
          <input type="file" required className="block w-full text-[14px] file:mr-3 file:rounded-md file:border file:border-rule file:bg-panel file:px-3 file:py-1.5"
            accept=".wav,.mp3,.m4a,.aac,.ogg,.flac,.opus,.mp4,.mov,.mkv,.webm,.json,.txt,.vtt,.srt"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </Field>

        <fieldset className="rounded-[10px] border border-ask/40 bg-ask-soft p-4">
          <legend className="px-1 font-semibold text-ask">Consent</legend>
          <p className="text-[14.5px]">Recording or transcribing people without their agreement is not allowed. Processing sends data to these services:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px]">
            <li>Audio and video go to <strong>Sarvam AI</strong> for transcription and speaker separation, when a Sarvam key is configured.</li>
            <li>Transcript text goes to the configured language model: <strong>Google Gemini</strong> (a third party) or a <strong>local Ollama</strong> model on this machine. The Diagnostics page shows which one is active.</li>
            <li>Files and results are stored in this server’s local database and upload folder.</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 text-[14.5px] font-medium">
            <input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} required />
            I confirm that every participant agreed to this recording and to the processing described above.
          </label>
        </fieldset>

        <Button kind="primary" type="submit" disabled={busy || !consent || !file || !title.trim()}>{busy ? 'Uploading…' : 'Upload and process'}</Button>
      </form>
    </>
  )
}
