import { useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, FileAudio, FileText, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react'
import { api } from '../lib/api'
import type { MeetingSummary } from '../types'
import { Button, ErrorBox, Field, PageHeader, Panel, errText, inputCls, useLoad } from '../components/ui'

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore']
const ACCEPT = '.wav,.mp3,.m4a,.aac,.ogg,.flac,.opus,.mp4,.mov,.mkv,.webm,.json,.txt,.vtt,.srt'
const TRANSCRIPT_EXT = ['json', 'txt', 'vtt', 'srt']

function localNow() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`)

export default function NewMeeting() {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(localNow())
  const [tz, setTz] = useState('Asia/Kolkata')
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const diag = useLoad(() => api.get<{ llm: { active: { provider: string | null; model: string | null } }; speech: { active: string | null } }>('/api/diagnostics'))
  const isTranscript = file ? TRANSCRIPT_EXT.includes(file.name.split('.').pop()?.toLowerCase() ?? '') : false
  const stt = diag.data?.speech.active
  const llm = diag.data?.llm.active.provider ? `${diag.data.llm.active.provider}/${diag.data.llm.active.model}` : null

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
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }
  function drop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setFile(f)
  }

  return (
    <>
      <PageHeader title="Add a meeting" sub="Upload a recording (audio or video) or an existing transcript. Nothing becomes a task until you approve it." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={submit} className="min-w-0 space-y-5">
          <ErrorBox error={error} />
          <Field label="Meeting title"><input className={inputCls} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Sprint review, week 43" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date and time" hint="Relative deadlines like “by Friday” are resolved from this date.">
              <input type="datetime-local" className={inputCls} required value={when} onChange={e => setWhen(e.target.value)} />
            </Field>
            <Field label="Meeting time zone">
              <select className={inputCls} value={tz} onChange={e => setTz(e.target.value)}>{TIMEZONES.map(z => <option key={z}>{z}</option>)}</select>
            </Field>
          </div>

          <div>
            <label htmlFor="meeting-file" className="mb-1.5 block text-[13px] font-medium text-ink">Recording or transcript</label>
            <input id="meeting-file" type="file" required accept={ACCEPT} className="peer sr-only" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <label htmlFor="meeting-file" onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-7 text-center transition-colors peer-focus-visible:border-sky ${over ? 'border-sky bg-sky-soft' : 'border-rule-strong bg-panel hover:bg-panel-2'}`}>
              {file ? (
                <span className="flex items-center gap-2.5 text-[14px]">
                  {isTranscript ? <FileText size={20} className="text-sky" /> : <FileAudio size={20} className="text-create" />}
                  <span className="font-medium text-ink">{file.name}</span><span className="text-faint">{fmtSize(file.size)}</span>
                  <button type="button" aria-label="Remove file" className="text-faint hover:text-cancel" onClick={e => { e.preventDefault(); setFile(null) }}><X size={16} /></button>
                </span>
              ) : (
                <>
                  <UploadCloud size={24} className="text-faint" />
                  <span className="text-[14px] text-ink"><span className="font-medium text-sky">Choose a file</span> or drop it here</span>
                </>
              )}
              <span className="text-[12.5px] text-faint">Audio: wav, mp3, m4a, aac, ogg, flac, opus. Video: mp4, mov, mkv, webm. Transcript: json, txt (“Speaker: text” lines), vtt, srt.</span>
            </label>
          </div>

          <fieldset className="rounded-xl border border-rule bg-panel px-4 py-4 shadow-soft">
            <legend className="flex items-center gap-1.5 px-1 text-[13.5px] font-semibold text-ask"><ShieldCheck size={15} />Consent</legend>
            <p className="text-[14px] text-ink">Recording or transcribing people without their agreement is not allowed. Processing sends data to these services:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-slate">
              <li>Audio and video go to <strong className="text-ink">Sarvam AI</strong> for transcription and speaker separation when a Sarvam key is configured; otherwise they are transcribed by a <strong className="text-ink">local Whisper</strong> model on this machine, which does not separate speakers.</li>
              <li>Transcript text goes to the configured language model: <strong className="text-ink">Google Gemini</strong> (a third party) or a <strong className="text-ink">local Ollama</strong> model on this machine. The Diagnostics page shows which one is active.</li>
              <li>Files and results are stored in this server’s local database and upload folder.</li>
            </ul>
            <label className="mt-3 flex items-start gap-2.5 rounded-lg bg-panel-2 px-3 py-2.5 text-[14px] font-medium text-ink">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={consent} onChange={e => setConsent(e.target.checked)} required />
              I confirm that every participant agreed to this recording and to the processing described above.
            </label>
          </fieldset>

          <Button kind="primary" type="submit" loading={busy} disabled={!consent || !file || !title.trim()} icon={<UploadCloud size={15} />}>{busy ? 'Uploading…' : 'Upload and process'}</Button>
        </form>

        <aside className="space-y-4">
          <Panel title="What happens next" icon={<Sparkles size={15} />}>
            <ol className="space-y-3 text-[13.5px]">
              {[
                ['Speech to text', isTranscript ? 'Skipped for transcript files.' : stt === 'sarvam' ? 'Sarvam saaras:v4, code-mixed, with speaker separation.' : stt === 'whisper' ? 'Local Whisper on this machine. No speaker separation.' : 'No speech service available: upload a transcript instead.'],
                ['Interpretation', llm ? `${llm} describes what was said as ordered events.` : 'No language model available right now.'],
                ['Rules and questions', 'The server works out proposed task changes and asks about anything unclear.'],
                ['Your review', 'Nothing reaches the task board until you approve it.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-3 text-[11.5px] font-semibold text-slate">{i + 1}</span>
                  <span><span className="font-medium text-ink">{t}</span><span className="block text-slate">{d}</span></span>
                </li>))}
            </ol>
          </Panel>
          <p className="flex items-start gap-2 px-1 text-[12.5px] text-faint"><ClipboardCheck size={14} className="mt-0.5 shrink-0" />A local model can take a few minutes per meeting. The meeting page shows progress and refreshes by itself.</p>
        </aside>
      </div>
    </>
  )
}
