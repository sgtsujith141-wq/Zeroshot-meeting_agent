import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileAudio, FileText, Mic, UploadCloud, X } from 'lucide-react'
import { api } from '../lib/api'
import type { MeetingSummary } from '../types'
import { Button, ErrorBox, Field, PageHeader, SyntheticTag, errText, inputCls, useLoad } from '../components/ui'
import Recorder, { type Recording } from '../components/Recorder'
// A synthetic transcript written for demonstrations (no real people). Bundled so the demo needs no file on disk.
import demoTranscript from '../../../demo/synthetic_meeting_1_planning.json?raw'
const DEMO_NAME = 'synthetic_meeting_1_planning.json'

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore']
const MEDIA_ACCEPT = '.wav,.mp3,.m4a,.aac,.ogg,.flac,.opus,.mp4,.mov,.mkv,.webm'
const TRANSCRIPT_ACCEPT = '.json,.txt,.vtt,.srt'
const TRANSCRIPT_EXT = ['json', 'txt', 'vtt', 'srt']
type Mode = 'record' | 'recording' | 'transcript'

function localNow() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`)

const MODES: { key: Mode; label: string; detail: string; icon: ReactNode }[] = [
  { key: 'record', label: 'Record audio', detail: 'Use this computer’s microphone', icon: <Mic size={18} /> },
  { key: 'recording', label: 'Upload recording', detail: 'Audio or video file', icon: <FileAudio size={18} /> },
  { key: 'transcript', label: 'Upload transcript', detail: 'JSON, text, VTT or SRT', icon: <FileText size={18} /> },
]

export default function NewMeeting() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  // ?mode=recording|transcript opens that option; &sample=1 also attaches the synthetic transcript.
  const [mode, setMode] = useState<Mode>(() => (['recording', 'transcript'].includes(params.get('mode') ?? '') ? params.get('mode') as Mode : 'record'))
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(localNow())
  const [tz, setTz] = useState('Asia/Kolkata')
  const [file, setFile] = useState<File | null>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [demo, setDemo] = useState(false)
  const diag = useLoad(() => api.get<{ llm: { active: { provider: string | null; model: string | null } }; speech: { active: string | null; whisper_local: { model: string } } }>('/api/diagnostics'))
  const stt = diag.data?.speech.active
  const llm = diag.data?.llm.active.provider ? `${diag.data.llm.active.provider}/${diag.data.llm.active.model}` : null
  const chosen = mode === 'record' ? recording?.file ?? null : file
  const wrongKind = !!file && mode !== 'record' && (mode === 'transcript') !== TRANSCRIPT_EXT.includes(file.name.split('.').pop()?.toLowerCase() ?? '')

  function choose(m: Mode) {
    setMode(m); setError(null)
    if (m !== mode) { setFile(null); setDemo(false) }
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!chosen || wrongKind) return
    setBusy(true); setError(null)
    let created: MeetingSummary | null = null
    try {
      created = await api.post<MeetingSummary>('/api/meetings', {
        title, scheduled_at: when, timezone: tz, consent_confirmed: consent,
        consent_statement: 'Organiser confirmed in the web form that every participant consented to recording and processing, including by third-party AI providers.',
      })
      const form = new FormData()
      form.append('file', chosen)
      form.append('auto_process', 'true')
      // A live recording is transcribed first, so its words can be read and corrected before analysis.
      if (mode === 'record') form.append('transcribe_only', 'true')
      await api.upload(`/api/meetings/${created.id}/upload`, form)
      nav(`/meetings/${created.id}`)
    } catch (err) {
      // A refused upload must not leave an empty meeting behind.
      let cleanup = ''
      if (created) {
        try { await api.del(`/api/meetings/${created.id}`) } catch { cleanup = ` The empty meeting “${title}” could not be removed; delete it from Meetings.` }
      }
      setError(`${errText(err).replace(/\.$/, '')}. ${cleanup ? cleanup.trim() : mode === 'record' ? 'Nothing was saved; the recording is still here, so you can try again.' : 'Nothing was saved; check the file and try again.'}`)
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
  useEffect(() => { if (params.get('sample') === '1' && mode === 'transcript') pickDemo() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  function recorded(r: Recording | null) {
    setRecording(r)
    if (r && !title.trim()) setTitle(`Recorded meeting, ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
  }
  const missing = !title.trim() ? 'Add a title' : !chosen ? (mode === 'record' ? 'Record something' : 'Add a file') : wrongKind ? 'Choose a matching file' : !consent ? 'Confirm consent' : null
  const action = mode === 'record' ? 'Transcribe recording' : 'Analyze meeting'

  return (
    <>
      <PageHeader title="New meeting" crumbs={[{ label: 'Meetings', to: '/meetings' }]} sub="Record a meeting or upload an existing recording." />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={submit} className="min-w-0 max-w-[720px] space-y-6">
          <ErrorBox error={error} />
          <div role="radiogroup" aria-label="How to add the meeting" className="grid grid-cols-3 gap-2">
            {MODES.map(m => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => choose(m.key)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors sm:flex-row sm:gap-3 sm:px-3.5 sm:py-3 ${mode === m.key ? 'border-accent bg-accent-soft' : 'border-rule bg-panel hover:border-rule-strong'}`}>
                <span className={mode === m.key ? 'text-accent' : 'text-faint'}>{m.icon}</span>
                <span><span className="block text-[13px] font-semibold leading-tight text-ink sm:text-[14px]">{m.label}</span><span className="hidden text-[12.5px] text-slate sm:block">{m.detail}</span></span>
              </button>
            ))}
          </div>

          {mode === 'record' ? (
            <div>
              <Recorder value={recording} onChange={recorded} />
              {stt === 'whisper' && <p className="mt-2 text-[13px] text-slate">Speaker separation is not available with the current transcription provider (local Whisper): every line will be labelled SPEAKER_00 until you name the speaker.</p>}
              {diag.data && !stt && <p role="alert" className="mt-2 text-[13px] text-cancel">No speech-to-text provider is available on this server, so a recording cannot be transcribed. Upload a transcript instead.</p>}
            </div>
          ) : (
            <div>
              <span className="mb-1 block text-[13px] font-medium text-ink" id="file-label">{mode === 'transcript' ? 'Transcript file' : 'Recording file'}</span>
              <input id="meeting-file" type="file" required={!file} accept={mode === 'transcript' ? TRANSCRIPT_ACCEPT : MEDIA_ACCEPT} aria-labelledby="file-label" className="peer sr-only" onChange={e => { setFile(e.target.files?.[0] ?? null); setDemo(false) }} />
              <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop} data-testid="drop-zone"
                className={`rounded-xl border border-dashed px-4 py-8 text-[14px] transition-colors peer-focus-visible:border-sky ${over ? 'border-sky bg-sky-soft' : 'border-rule-strong bg-panel'}`}>
                {file ? (
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="shrink-0 text-accent" aria-hidden />
                    <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-medium text-ink">{file.name}</span>{demo && <SyntheticTag />}<span className="shrink-0 text-faint">{fmtSize(file.size)}</span></span>
                    <Button kind="ghost" size="sm" aria-label="Remove file" icon={<X size={14} />} onClick={() => { setFile(null); setDemo(false) }} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-center text-slate">
                    <UploadCloud size={24} className="text-accent" aria-hidden />
                    <span><label htmlFor="meeting-file" className="cursor-pointer font-medium text-sky hover:underline">Choose a file</label> or drop it here</span>
                  </div>
                )}
                <p className={`mt-2 text-[12.5px] text-faint ${file ? '' : 'text-center'}`}>{mode === 'transcript'
                  ? 'JSON, text (“Speaker: text” lines), VTT or SRT.' : 'Audio: wav, mp3, m4a, aac, ogg, flac, opus. Video: mp4, mov, mkv, webm.'}</p>
              </div>
              {wrongKind && <p role="alert" className="mt-2 text-[13px] text-cancel">{mode === 'transcript' ? 'That is not a transcript file. Choose Upload recording for audio or video.' : 'That is a transcript file. Choose Upload transcript for it.'}</p>}
              {mode === 'transcript' && !file && (
                <p className="mt-2 text-[13px] text-slate">
                  No file to hand? <button type="button" onClick={pickDemo} className="font-medium text-sky hover:underline">Use the synthetic demo transcript</button>: a short planning meeting written for testing, with no real people in it.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
            <Field label="Meeting title"><input className={inputCls} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Sprint review, week 43" /></Field>
            <Field label="Date and time" hint="“By Friday” is worked out from this date.">
              <input type="datetime-local" className={inputCls} required value={when} onChange={e => setWhen(e.target.value)} />
            </Field>
          </div>
          <details className="text-[13.5px]">
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

          <div className="flex flex-wrap items-center gap-3">
            <Button kind="primary" type="submit" className="h-11 px-6 text-[14.5px]" loading={busy} disabled={!!missing}>{busy ? 'Uploading…' : action}</Button>
            {!busy && missing && <span className="text-[13px] text-faint">{missing} to continue.</span>}
          </div>
        </form>

        <aside className="space-y-3 text-[13.5px]">
          <h2 className="text-[15px] font-semibold text-ink">What happens next</h2>
          <ol className="space-y-3">
            {(mode === 'record' ? [
              ['Transcription', stt === 'sarvam' ? 'Sarvam saaras:v4, with speaker separation.' : stt === 'whisper' ? `Local Whisper (${diag.data?.speech.whisper_local.model ?? 'faster-whisper'}) on this machine. A short clip takes seconds.` : 'No speech service is available.'],
              ['Read and correct', 'The transcript appears as soon as it is ready. Fix any misheard line.'],
              ['Analysis', llm ? `When you continue, ${llm} works out decisions and tasks. With a local model this takes a few minutes.` : 'No language model is available right now.'],
              ['Your approval', 'Nothing reaches the task board until you approve it.'],
            ] : [
              ['Speech to text', mode === 'transcript' ? 'Skipped for transcript files.' : stt === 'sarvam' ? 'Sarvam saaras:v4, with speaker separation.' : stt === 'whisper' ? 'Local Whisper on this machine. Speakers are not separated.' : 'No speech service is available: upload a transcript instead.'],
              ['Analysis', llm ? `${llm} works out decisions and tasks; the transcript shows as soon as it is ready.` : 'No language model is available right now.'],
              ['Your approval', 'Nothing reaches the task board until you approve it.'],
            ]).map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="tnum w-4 shrink-0 text-faint">{i + 1}</span><span><span className="font-medium text-ink">{t}</span><span className="block text-slate">{d}</span></span></li>))}
          </ol>
        </aside>
      </div>
    </>
  )
}
