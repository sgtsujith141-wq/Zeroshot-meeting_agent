import { useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, UploadCloud, X } from 'lucide-react'
import { api } from '../lib/api'
import type { MeetingSummary } from '../types'
import { Button, ErrorBox, Field, PageHeader, Section, SyntheticTag, errText, inputCls, useLoad } from '../components/ui'
// A synthetic transcript written for demonstrations (no real people). Bundled so the demo needs no file on disk.
import demoTranscript from '../../../demo/synthetic_meeting_1_planning.json?raw'
const DEMO_NAME = 'synthetic_meeting_1_planning.json'

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
  const [demo, setDemo] = useState(false)
  const diag = useLoad(() => api.get<{ llm: { active: { provider: string | null; model: string | null } }; speech: { active: string | null } }>('/api/diagnostics'))
  const isTranscript = file ? TRANSCRIPT_EXT.includes(file.name.split('.').pop()?.toLowerCase() ?? '') : false
  const stt = diag.data?.speech.active
  const llm = diag.data?.llm.active.provider ? `${diag.data.llm.active.provider}/${diag.data.llm.active.model}` : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true); setError(null)
    let created: MeetingSummary | null = null
    try {
      created = await api.post<MeetingSummary>('/api/meetings', {
        title, scheduled_at: when, timezone: tz, consent_confirmed: consent,
        consent_statement: 'Organiser confirmed in the web form that every participant consented to recording and processing, including by third-party AI providers.',
      })
      const form = new FormData()
      form.append('file', file)
      form.append('auto_process', 'true')
      await api.upload(`/api/meetings/${created.id}/upload`, form)
      nav(`/meetings/${created.id}`)
    } catch (err) {
      // A refused upload must not leave an empty meeting behind.
      let cleanup = ''
      if (created) {
        try { await api.del(`/api/meetings/${created.id}`) } catch { cleanup = ` The empty meeting “${title}” could not be removed; delete it from Meetings.` }
      }
      setError(`${errText(err).replace(/\.$/, '')}. ${cleanup ? cleanup.trim() : 'Nothing was saved; check the file and try again.'}`)
    } finally { setBusy(false) }
  }
  function drop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) { setFile(f); setDemo(false) }
  }
  function pickDemo() {
    const d = JSON.parse(demoTranscript) as { title: string; scheduled_at: string; timezone: string }
    setFile(new File([demoTranscript], DEMO_NAME, { type: 'application/json' }))
    setTitle(d.title); setWhen(d.scheduled_at.slice(0, 16)); setTz(d.timezone); setDemo(true)
  }

  return (
    <>
      <PageHeader title="New meeting" crumbs={[{ label: 'Meetings', to: '/meetings' }]}
        sub="Add a recording or a transcript. The tasks it finds wait for your approval before anything changes." />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={submit} className="min-w-0 max-w-[640px] space-y-5 rounded-xl border border-rule bg-panel p-5 sm:p-6">
          <ErrorBox error={error} />
          <Field label="Meeting title"><input className={inputCls} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Sprint review, week 43" /></Field>
          <Field label="Date and time" hint="Relative deadlines like “by Friday” are worked out from this date.">
            <input type="datetime-local" className={`${inputCls} sm:max-w-[16rem]`} required value={when} onChange={e => setWhen(e.target.value)} />
          </Field>

          <div>
            <span className="mb-1 block text-[13px] font-medium text-ink" id="file-label">Recording or transcript</span>
            <input id="meeting-file" type="file" required={!file} accept={ACCEPT} aria-labelledby="file-label" className="peer sr-only" onChange={e => { setFile(e.target.files?.[0] ?? null); setDemo(false) }} />
            <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop} data-testid="drop-zone"
              className={`rounded-lg border border-dashed px-4 py-6 text-[14px] transition-colors peer-focus-visible:border-sky ${over ? 'border-sky bg-sky-soft' : 'border-rule-strong bg-panel-2/50'}`}>
              {file ? (
                <div className="flex items-center gap-2">
                  <FileText size={18} className="shrink-0 text-accent" aria-hidden />
                  <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-medium text-ink">{file.name}</span>{demo && <SyntheticTag />}<span className="shrink-0 text-faint">{fmtSize(file.size)}, {isTranscript ? 'transcript' : 'recording'}</span></span>
                  <Button kind="ghost" size="sm" aria-label="Remove file" icon={<X size={14} />} onClick={() => { setFile(null); setDemo(false) }} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-center text-slate">
                  <UploadCloud size={22} className="text-accent" aria-hidden />
                  <span><label htmlFor="meeting-file" className="cursor-pointer font-medium text-sky hover:underline">Choose a file</label> or drop it here</span>
                </div>
              )}
              <p className={`mt-2 text-[12.5px] text-faint ${file ? '' : 'text-center'}`}>Audio: wav, mp3, m4a, aac, ogg, flac, opus. Video: mp4, mov, mkv, webm. Transcript: json, txt (“Speaker: text” lines), vtt, srt.</p>
            </div>
            {!file && (
              <p className="mt-2 text-[13px] text-slate">
                No file to hand? <button type="button" onClick={pickDemo} className="font-medium text-sky hover:underline">Use the synthetic demo transcript</button>: a short planning meeting written for testing, with no real people in it.
              </p>
            )}
          </div>

          <details className="group text-[13.5px]">
            <summary className="cursor-pointer text-slate hover:text-ink">More options</summary>
            <div className="mt-3 sm:max-w-[16rem]">
              <Field label="Meeting time zone" hint="Deadlines are worked out in this time zone.">
                <select className={inputCls} value={tz} onChange={e => setTz(e.target.value)}>{TIMEZONES.map(z => <option key={z}>{z}</option>)}</select>
              </Field>
            </div>
          </details>

          <div className="space-y-2 border-t border-rule pt-5">
            <h2 className="text-[14px] font-semibold">Consent</h2>
            <p className="text-ink">Recording or transcribing people without their agreement is not allowed. Processing sends data to these services:</p>
            <ul className="list-disc space-y-1 pl-5 text-slate">
              <li>Audio and video go to <strong className="font-medium text-ink">Sarvam AI</strong> for transcription and speaker separation when a Sarvam key is configured; otherwise a <strong className="font-medium text-ink">local Whisper</strong> model on this machine transcribes them, without separating speakers.</li>
              <li>Transcript text goes to the configured language model: <strong className="font-medium text-ink">Google Gemini</strong> (a third party) or a <strong className="font-medium text-ink">local Ollama</strong> model on this machine.</li>
              <li>Files and results are stored in this server’s local database and upload folder.</li>
            </ul>
            <label className="flex items-start gap-2.5 pt-1 font-medium text-ink">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={consent} onChange={e => setConsent(e.target.checked)} required />
              I confirm that every participant agreed to this recording and to the processing described above.
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button kind="primary" type="submit" className="h-10 px-5 text-[14px]" loading={busy} disabled={!consent || !file || !title.trim()}>{busy ? 'Uploading…' : 'Analyze meeting'}</Button>
            {!busy && (!consent || !file || !title.trim()) && <span className="text-[13px] text-faint">{!title.trim() ? 'Add a title' : !file ? 'Add a file' : 'Confirm consent'} to continue.</span>}
          </div>
        </form>

        <aside>
          <Section title="What happens next">
            <ol className="space-y-3 text-[13.5px]">
              {[
                ['Speech to text', isTranscript ? 'Skipped for transcript files.' : stt === 'sarvam' ? 'Sarvam saaras:v4, with speaker separation.' : stt === 'whisper' ? 'Local Whisper on this machine. Speakers are not separated.' : 'No speech service is available: upload a transcript instead.'],
                ['Interpretation', llm ? `${llm} describes what was said as ordered events.` : 'No language model is available right now.'],
                ['Rules and questions', 'The server works out proposed task changes and asks about anything unclear.'],
                ['Your approval', 'Nothing reaches the task board until you approve it.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3"><span className="tnum w-4 shrink-0 text-faint">{i + 1}</span><span><span className="font-medium text-ink">{t}</span><span className="block text-slate">{d}</span></span></li>))}
            </ol>
            <p className="mt-4 text-[12.5px] text-faint">A local model takes a few minutes per meeting. The meeting page shows each step as it finishes.</p>
          </Section>
        </aside>
      </div>
    </>
  )
}
