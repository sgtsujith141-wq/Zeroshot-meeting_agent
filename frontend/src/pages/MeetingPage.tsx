import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Download, FileText, X as XIcon } from 'lucide-react'
import { api, ApiError, fmtDate, fmtDateTime, fmtTime } from '../lib/api'
import type { ChangeSet, Clarification, MeetingDetail, MeetingSummary, Participant, Task } from '../types'
import {
  Button, Dialog, Drawer, Empty, ErrorBox, Field, Loading, Menu, Notice, PageHeader, SegRef, Section, Status, SyntheticTag, Tabs,
  errText, inputCls, plural, useLoad, useToast,
} from '../components/ui'
import Transcript, { type Focus } from '../components/Transcript'
import { BUSY, isSynthetic, meetingStatus } from '../lib/status'
import { Q_LABEL, plan, type Planned } from '../lib/changes'

const STEP: Record<string, string> = { queue: 'Queued', transcribe: 'Speech to text', interpret: 'Interpretation', minutes: 'Minutes', changeset: 'Proposed changes', recover: 'Recovery' }

// ---- processing ----------------------------------------------------------------------------------

type StageState = 'done' | 'active' | 'waiting' | 'failed' | 'todo'
type Log = MeetingDetail['processing_log']

const secs = (a: string, b: number) => Math.max(0, Math.round((b - Date.parse(a)) / 1000))
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const lastIndex = (log: Log, pred: (l: Log[number]) => boolean) => { for (let i = log.length - 1; i >= 0; i--) if (pred(log[i])) return i; return -1 }
const isMedia = (m: { source_type: string | null }) => m.source_type === 'audio' || m.source_type === 'video'
/** Local Whisper never separates speakers; Sarvam reports whether it did. */
const undiarized = (m: MeetingDetail) => m.stt_provider === 'whisper-local'
  || m.processing_log.some(l => l.step === 'transcribe' && /diarized=False/.test(l.detail ?? ''))

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [on])
  return now
}

/** The five stages people see, each derived from the backend status and its processing log:
 *  the log records the end of every step, so a stage starts when the previous entry was written. */
function stages(m: MeetingDetail, now: number): { label: string; state: StageState; detail: string }[] {
  const log = m.processing_log
  const st = m.processing_status
  const media = isMedia(m)
  const has = m.segments.length > 0
  const q = lastIndex(log, l => l.step === 'queue')
  const run = q >= 0 ? log.slice(q) : log
  const ok = (step: string) => run.find(l => l.step === step && l.status === 'ok')
  const fail = st === 'failed' ? run.find(l => l.status !== 'ok') ?? { step: (m.processing_error ?? '').split(':')[0], at: '', status: 'error', detail: null } : undefined
  const before = (step: string) => { const i = run.findIndex(l => l.step === step && l.status === 'ok'); return i > 0 ? run[i - 1].at : undefined }
  const took = (step: string) => { const e = ok(step), s = before(step); return e && s ? `Done in ${clock(secs(s, Date.parse(e.at)))}` : 'Done' }
  const running = () => (log.length ? `Running for ${clock(secs(log[log.length - 1].at, now))}` : 'Running')
  const t = lastIndex(log, l => l.step === 'transcribe' && l.status === 'ok')
  const tq = t >= 0 ? lastIndex(log.slice(0, t), l => l.step === 'queue') : -1

  const transcription: [StageState, string] = !media ? ['done', 'Not needed: a transcript was uploaded']
    : has && t >= 0 ? ['done', `${tq >= 0 ? `Done in ${clock(secs(log[tq].at, Date.parse(log[t].at)))}` : 'Done'}${m.stt_provider ? `, ${m.stt_provider}` : ''}`]
    : st === 'transcribing' ? ['active', running()]
    : st === 'queued' ? ['active', 'Waiting to start']
    : fail && ['transcribe', 'start', 'recover'].includes(fail.step) ? ['failed', 'Stopped here'] : ['todo', '']
  const extract: [StageState, string] = st === 'interpreting' ? ['active', running()]
    : st === 'queued' && has ? ['active', 'Waiting to start']
    : st === 'transcribed' ? ['waiting', 'Waiting for you to start the analysis']
    : fail?.step === 'interpret' || (fail?.step === 'recover' && has && !ok('interpret')) ? ['failed', 'Stopped here']
    : ok('interpret') ? ['done', took('interpret')] : ['todo', '']
  const results: [StageState, string] = st === 'writing_minutes' ? ['active', running()]
    : fail?.step === 'minutes' || (fail?.step === 'recover' && !!ok('interpret')) ? ['failed', 'Stopped here']
    : ok('changeset') ? ['done', took('minutes')] : ['todo', '']
  return [
    { label: media ? 'Audio received' : 'Transcript received', state: 'done',
      detail: media ? `${m.file_name ?? 'Recording'}${m.duration_seconds ? `, ${clock(Math.round(m.duration_seconds))} long` : ''}` : m.file_name ?? 'Transcript file' },
    { label: media ? 'Transcription' : 'Transcription', state: transcription[0], detail: transcription[1] },
    { label: 'Transcript ready', state: has ? 'done' : 'todo', detail: has ? `${plural(m.segments.length, 'line')}, shown below` : '' },
    { label: 'Extracting decisions and actions', state: extract[0], detail: extract[1] },
    { label: 'Preparing meeting results', state: results[0], detail: results[1] },
  ]
}

function transcriptText(m: MeetingDetail) {
  const names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  const head = [`${m.title}`, `${fmtDate(m.scheduled_at)} (${m.timezone})`, m.stt_provider ? `Transcribed by ${m.stt_provider}` : 'Uploaded transcript',
    undiarized(m) ? 'Speaker separation was not available with this transcription provider.' : '', '']
  return [...head, ...m.segments.map(s => {
    const who = names[s.speaker_label] && names[s.speaker_label] !== s.speaker_label ? `${names[s.speaker_label]} (${s.speaker_label})` : s.speaker_label
    return `[${fmtTime(s.start_seconds)}${s.end_seconds != null ? `–${fmtTime(s.end_seconds)}` : ''}] ${who}: ${s.text}`
  })].filter((l, i) => l || i === 4).join('\n') + '\n'
}
function downloadTranscript(m: MeetingDetail) {
  const url = URL.createObjectURL(new Blob([transcriptText(m)], { type: 'text/plain;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${m.title.replace(/[^\w.-]+/g, '_')}-transcript.txt` })
  a.click()
  URL.revokeObjectURL(url)
}

/** The recording and its transcript, available as soon as transcription finished, whatever
 *  happens to the analysis afterwards. Lines can be corrected while nothing is running. */
function TranscriptPanel({ m, audioUrl, editable, onSaved }: { m: MeetingDetail; audioUrl: string | null; editable: boolean; onSaved: () => void }) {
  const toast = useToast()
  const audio = useRef<HTMLAudioElement>(null)
  const names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  async function edit(key: string, text: string) {
    try { await api.patch(`/api/meetings/${m.id}/segments/${key}`, { text }); toast('ok', `${key} corrected.`); onSaved(); return true }
    catch (e) { toast('error', errText(e)); return false }
  }
  return (
    <section aria-labelledby="transcript-h" className="anim-rise rounded-xl border border-rule bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <div>
          <h2 id="transcript-h" className="text-[15px] font-semibold text-ink">Transcript <span className="tnum font-normal text-faint">{m.segments.length}</span></h2>
          <p className="text-[12.5px] text-slate">{m.stt_provider ? `Transcribed by ${m.stt_provider}. ` : ''}Timestamps are per segment, not per word.{editable ? ' Correct any misheard line before the analysis.' : ''}</p>
        </div>
        <Button size="sm" icon={<Download size={14} />} onClick={() => downloadTranscript(m)}>Download transcript</Button>
      </div>
      <div className="px-5 py-3">
        {undiarized(m) && <p className="mb-2 text-[13px] text-ask">Speaker separation is not available with the current transcription provider. Every line is labelled {m.segments[0]?.speaker_label ?? 'SPEAKER_00'}; name the speaker under Speakers after the analysis.</p>}
        {audioUrl && <audio ref={audio} controls preload="metadata" src={audioUrl} className="mb-2 h-10 w-full" aria-label="Meeting recording" />}
        <Transcript segments={m.segments} names={names} audio={audio} hasAudio={!!audioUrl} onEdit={editable ? edit : undefined} />
      </div>
    </section>
  )
}

function ProcessingView({ m, audioUrl, onAnalyze, onRetranscribe, onSaved, busy }: {
  m: MeetingDetail; audioUrl: string | null; onAnalyze: () => void; onRetranscribe: () => void; onSaved: () => void; busy: boolean
}) {
  const working = BUSY.includes(m.processing_status)
  const now = useNow(working)
  const steps = stages(m, now)
  const has = m.segments.length > 0
  const ready = m.processing_status === 'transcribed'
  const failed = m.processing_status === 'failed'
  const q = lastIndex(m.processing_log, l => l.step === 'queue')
  const startedAt = q >= 0 ? m.processing_log[q].at : undefined
  const transcribing = working && !has
  const sample = useLoad(() => api.get<MeetingSummary[]>('/api/meetings'), [m.id])
  const earlier = (sample.data ?? []).filter(x => x.id !== m.id && isSynthetic(x) && x.processing_status === 'ready_for_review' && x.change_set && x.created_at < m.created_at)
  const pick = earlier.find(x => x.title === m.title) ?? earlier.find(x => x.change_set?.state === 'APPLIED') ?? earlier[0]
  const silent = ready && !has // transcribed, but nothing was recognised as speech
  const title = transcribing ? 'Transcribing your recording' : working ? 'Analyzing your meeting' : silent ? 'No speech recognised' : ready ? 'Transcript ready'
    : failed && has ? 'Transcription complete; AI analysis unavailable.' : failed ? (isMedia(m) ? 'Transcription failed' : 'Analysis stopped') : 'Not processed'
  const sub = transcribing ? 'The words appear below as soon as speech-to-text finishes.'
    : working ? 'The transcript is below. Decisions and tasks follow when the analysis finishes; this page updates by itself.'
    : silent ? 'The recording was transcribed, but no speech was found in it. Check that the right microphone is selected and not muted, then record again.'
    : ready ? 'Read the transcript below and correct anything misheard. Then start the analysis to find decisions and tasks.'
    : failed ? m.processing_error : ''

  return (
    <div className="space-y-6">
      <div className="anim-rise rounded-xl border border-rule bg-panel px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className={`text-[17px] font-semibold ${failed ? 'text-cancel' : 'text-ink'}`}>{title}</h2>
          {startedAt && working && <span className="tnum text-[13px] text-slate"><span className="sr-only">Elapsed </span>{clock(secs(startedAt, now))}</span>}
        </div>
        {sub && <p className="mt-1 max-w-[70ch] text-[13.5px] text-slate">{sub}</p>}
        <ol className="mt-5 grid gap-y-4 sm:grid-cols-5 sm:gap-x-3" aria-label="Analysis steps">
          {steps.map((s, i) => (
            <li key={s.label} data-state={s.state} className="relative flex gap-3 sm:block">
              {i < steps.length - 1 && <span aria-hidden className={`absolute left-[11px] top-7 h-[calc(100%-0.25rem)] w-px sm:left-7 sm:top-[11px] sm:h-px sm:w-[calc(100%-1.25rem)] ${s.state === 'done' ? 'bg-accent' : 'bg-rule-strong'}`} />}
              <span aria-hidden className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                s.state === 'done' ? 'border-accent bg-accent text-on-accent' : s.state === 'active' ? 'border-accent bg-accent-soft' : s.state === 'waiting' ? 'border-accent bg-panel' : s.state === 'failed' ? 'border-cancel bg-cancel-soft text-cancel' : 'border-rule-strong bg-panel'}`}>
                {s.state === 'done' ? <Check size={13} strokeWidth={2.6} /> : s.state === 'active' ? <span className="anim-pulse h-2 w-2 rounded-full bg-accent" /> : s.state === 'waiting' ? <span className="h-2 w-2 rounded-full bg-accent" /> : s.state === 'failed' ? <XIcon size={13} strokeWidth={2.6} /> : null}
              </span>
              <div className="min-w-0 sm:mt-2.5 sm:pr-2">
                <div className={`text-[14px] leading-snug ${s.state === 'todo' ? 'text-faint' : 'font-medium text-ink'}`}>{s.label}<span className="sr-only">: {s.state === 'todo' ? 'not started' : s.state}</span></div>
                {s.detail && <div className={`tnum mt-0.5 text-[12.5px] ${s.state === 'failed' ? 'text-cancel' : 'text-slate'}`}>{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
        {!working && (
          <div className="mt-6 flex flex-wrap gap-2">
            {has && <Button kind="primary" className="h-10 px-5 text-[14px]" loading={busy} onClick={onAnalyze}>{ready ? 'Analyze meeting' : 'Retry analysis'}</Button>}
            {!has && isMedia(m) && failed && <Button kind="primary" loading={busy} onClick={onRetranscribe}>Try transcription again</Button>}
            {!has && <Link to="/meetings/new" className="inline-flex h-8 items-center rounded-md border border-rule-strong px-3 text-[13.5px] font-medium hover:bg-panel-2">{silent ? 'Record again' : 'Upload a different file'}</Link>}
          </div>
        )}
      </div>
      {working && has && pick && (
        <p className="px-1 text-[13px] text-slate">
          Taking too long for the time you have? <Link to={`/meetings/${pick.id}`} className="font-medium text-sky hover:underline">Open a sample processed earlier</Link>: “{pick.title}”,
          a separate synthetic meeting analysed on {fmtDate(pick.created_at)}. It is not the result of this upload, which keeps running here.
        </p>
      )}
      {has ? <TranscriptPanel m={m} audioUrl={audioUrl} editable={!working} onSaved={onSaved} />
        : isMedia(m) && audioUrl && <audio controls preload="metadata" src={audioUrl} className="h-10 w-full" aria-label="Meeting recording" />}
    </div>
  )
}

// ---- results --------------------------------------------------------------------------------------

type Segs = Record<string, MeetingDetail['segments'][number]>
type Names = Record<string, string | null>
type More = 'speakers' | 'share' | 'technical'

function Refs({ ids, segs, names, show }: { ids: string[]; segs: Segs; names: Names; show: (k: string) => void }) {
  if (!ids.length) return null
  return <span className="inline-flex flex-wrap gap-x-2.5 gap-y-0.5">{ids.map(k => <SegRef key={k} segKey={k} seg={segs[k]} name={names[segs[k]?.speaker_label]} onClick={() => show(k)} />)}</span>
}

function Block({ title, count, children, actions }: { title: string; count?: number; children: ReactNode; actions?: ReactNode }) {
  return <Section title={title} count={count} actions={actions}><div className="rounded-lg border border-rule bg-panel">{children}</div></Section>
}
const Quiet = ({ children }: { children: ReactNode }) => <p className="px-4 py-3.5 text-[13.5px] text-faint">{children}</p>

export default function MeetingPage() {
  const { id } = useParams()
  const mid = Number(id)
  const nav = useNavigate()
  const toast = useToast()
  const { data: m, error, loading, reload } = useLoad(() => api.get<MeetingDetail>(`/api/meetings/${mid}`), [mid],
    d => (d && BUSY.includes(d.processing_status) ? 2000 : undefined))
  const working = !!m && BUSY.includes(m.processing_status)
  const csKey = m && !working && m.change_set ? `${m.change_set.id}:${m.change_set.state}` : null
  const actions = useLoad(async () => {
    if (!csKey) return null
    const [cs, board] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<Task[]>('/api/tasks')])
    return { cs, planned: plan(cs, board) }
  }, [mid, csKey])
  const [more, setMore] = useState<More>('speakers')
  const [focus, setFocus] = useState<Focus | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rerun' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (m?.source_type === 'audio' || m?.source_type === 'video')
      api.get<{ url: string }>(`/api/meetings/${mid}/media-url`).then(r => setAudioUrl(r.url)).catch(() => setAudioUrl(null))
  }, [mid, m?.source_type])
  useEffect(() => { // honour #s12 links from other pages
    const k = location.hash.slice(1)
    if (k && m?.segments.length && !working) { setFocus({ key: k, n: Date.now() }); setDrawer(true) }
  }, [m?.segments.length, working]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !m) return <Loading />
  if (!m) return <><PageHeader title="Meeting" crumbs={[{ label: 'Meetings', to: '/meetings' }]} /><ErrorBox error={error} onRetry={reload} /></>
  const names: Names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  const segs: Segs = Object.fromEntries(m.segments.map(s => [s.seg_key, s]))
  const st = meetingStatus({ ...m, change_set: m.change_set })
  const show = (k: string) => { setFocus({ key: k, n: Date.now() }); setDrawer(true) }
  const isAudio = m.source_type === 'audio' || m.source_type === 'video'
  const pendingCs = !!m.change_set && ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(m.change_set.state)
  const hasResults = !!m.minutes?.summary || !!m.change_set

  async function rerun() {
    setBusy(true)
    try { await api.post(`/api/meetings/${mid}/process`, { steps: ['interpret', 'minutes'] }); setConfirm(null); toast('info', 'Analysis started again. This page shows each step as it finishes.'); await reload() }
    catch (e) { setConfirm(null); toast('error', errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try { await api.del(`/api/meetings/${mid}`); toast('ok', `“${m!.title}” was deleted.`); nav('/meetings') }
    catch (e) { setConfirm(null); toast('error', errText(e)) } finally { setBusy(false) }
  }

  const reviewBtn = m.change_set && (
    <Link to={`/approvals/${mid}`} className={`inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium ${pendingCs ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-rule-strong bg-panel hover:bg-panel-2'}`}>
      {pendingCs ? 'Review and approve tasks' : 'View approved tasks'}
    </Link>
  )
  const header = (
    <PageHeader title={m.title} crumbs={[{ label: 'Meetings', to: '/meetings' }]}
      meta={<>
        {isSynthetic(m) && <SyntheticTag />}
        <Status tone={st.tone} busy={st.busy}>{st.label}</Status>
        <span>{fmtDate(m.scheduled_at)}</span>
        <span>{isAudio ? `Recording${m.stt_provider ? `, transcribed by ${m.stt_provider}` : ''}` : m.source_type ? 'Imported transcript' : 'Nothing uploaded'}</span>
      </>}
      actions={<>
        {!working && hasResults && reviewBtn}
        {!working && m.segments.length > 0 && <Button size="md" className="h-9" icon={<FileText size={15} />} onClick={() => { setFocus(null); setDrawer(true) }}>Transcript</Button>}
        <Menu label="More" items={[
          { label: 'Re-run analysis', onSelect: () => setConfirm('rerun'), disabled: working || !m.segments.length },
          { label: 'Delete meeting', onSelect: () => setConfirm('delete'), danger: true, disabled: working },
        ]} />
      </>} />
  )

  const dialogs = <>
    <Dialog open={confirm === 'rerun'} onClose={() => setConfirm(null)} title="Re-run the analysis?"
      footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button kind="primary" loading={busy} onClick={rerun}>Re-run analysis</Button></>}>
      <p className="text-slate">This calls the configured language model again (several minutes with a local model) and works out the proposed tasks again. Approved meetings cannot be re-analysed.</p>
    </Dialog>
    <Dialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Delete this meeting?"
      footer={<><Button onClick={() => setConfirm(null)}>Keep it</Button><Button kind="danger" loading={busy} onClick={remove}>Delete meeting</Button></>}>
      <p className="text-slate">This removes the transcript, the uploaded recording, the summary and any unapproved tasks for “{m.title}”. It cannot be undone. A meeting whose tasks were approved cannot be deleted.</p>
    </Dialog>
  </>

  async function start(steps: string[], note: string) {
    setBusy(true)
    try { await api.post(`/api/meetings/${mid}/process`, { steps }); toast('info', note); await reload() }
    catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  if (working || (m.processing_status === 'transcribed' && !m.change_set) || (m.processing_status === 'failed' && !hasResults)) {
    return <>{header}<ProcessingView m={m} audioUrl={audioUrl} busy={busy} onSaved={() => void reload()}
      onAnalyze={() => start(['interpret', 'minutes'], 'Analysis started. The transcript stays available while it runs.')}
      onRetranscribe={() => start(['transcribe'], 'Transcription started again.')} />{dialogs}</>
  }

  const planned = actions.data?.planned ?? []
  const cs = actions.data?.cs
  const live = !!cs && ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(cs.state)
  const excluded = new Set(cs?.proposal.items.filter(i => i.excluded).map(i => i.key) ?? [])
  const toAnswer: Clarification[] = live ? cs!.proposal.clarifications
    .filter(c => !c.deferred && !c.answer && !(c.item_keys.length > 0 && c.item_keys.every(k => excluded.has(k)))).sort((a, b) => a.rank - b.rank) : []
  const tasks = planned.filter(p => p.group !== 'none')
  const notTasks = planned.filter(p => p.group === 'none')

  return (
    <>
      {header}
      {m.processing_status === 'failed' && (
        <div className="mb-5"><Notice tone="cancel" role="status" title="The latest analysis failed"
          actions={m.segments.length > 0 && <Button size="sm" onClick={() => setConfirm('rerun')}>Try again</Button>}>
          {m.processing_error} The results below are from the previous successful analysis.</Notice></div>
      )}
      {m.processing_status === 'created' && !m.source_type && (
        <div className="mb-5"><Notice tone="neutral" title="Nothing uploaded yet">This meeting has no recording or transcript. <Link to="/meetings/new" className="text-sky hover:underline">Add a meeting with a file</Link> instead.</Notice></div>
      )}

      <div className="anim-rise grid gap-x-10 gap-y-9 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-9">
          <Section title="Meeting summary">
            {m.minutes?.summary ? <p className="max-w-[72ch] text-[15px] leading-relaxed text-ink">{m.minutes.summary}</p>
              : <p className="text-faint">The summary appears after the meeting is analysed.</p>}
          </Section>

          {!!m.minutes?.discussion?.length && (
            <Block title="Key discussions" count={m.minutes.discussion.length}>
              <ul className="divide-y divide-rule">{m.minutes.discussion.map((t, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="font-medium text-ink">{t.topic}</div>
                  <p className="mt-0.5 max-w-[75ch] text-slate">{t.summary}</p>
                  <div className="mt-1"><Refs ids={t.segment_ids} segs={segs} names={names} show={show} /></div>
                </li>))}
              </ul>
            </Block>
          )}

          <Block title="Decisions made" count={m.decisions.length}>
            {!m.decisions.length ? <Quiet>No decisions were recorded in this meeting.</Quiet> : (
              <ul className="divide-y divide-rule">{m.decisions.map(d => (
                <li key={d.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span className="font-medium text-ink">{d.text}</span>
                    <Status tone={d.approval_status === 'approved' ? 'done' : d.approval_status === 'rejected' ? 'neutral' : 'ask'}>{d.approval_status === 'approved' ? 'Approved' : d.approval_status === 'rejected' ? 'Not recorded' : 'Awaiting approval'}</Status></div>
                  <p className="mt-0.5 text-[13.5px] text-slate">{d.rationale ? `Why: ${d.rationale}` : 'No reason was given.'}</p>
                  <div className="mt-1"><Refs ids={d.evidence_segment_ids} segs={segs} names={names} show={show} /></div>
                </li>))}
              </ul>
            )}
          </Block>

          <Section title="Action items" count={tasks.length}>
            <ErrorBox error={actions.error} onRetry={actions.reload} />
            {!m.change_set ? <div className="rounded-lg border border-rule bg-panel"><Quiet>No action items yet. They are worked out when the meeting is analysed.</Quiet></div>
              : actions.loading && !actions.data ? <Loading rows={3} /> : (
                <ActionTable rows={tasks} segs={segs} names={names} show={show} />
              )}
            {notTasks.length > 0 && (
              <details className="mt-2 text-[13.5px]">
                <summary className="cursor-pointer text-slate hover:text-ink">{plural(notTasks.length, 'other mention')}, not becoming tasks</summary>
                <ul className="mt-1.5 space-y-1 pl-4">{notTasks.map(p => <li key={p.item.key} className="text-slate"><span className="text-ink">{p.item.title}</span>: {p.notes[0] ?? p.status.label}</li>)}</ul>
              </details>
            )}
          </Section>

          <Block title="Questions to clarify" count={toAnswer.length + m.open_questions.length}
            actions={toAnswer.length > 0 && <Link to={`/approvals/${mid}`} className="text-sky hover:underline">Answer them</Link>}>
            {!toAnswer.length && !m.open_questions.length ? <Quiet>Nothing to clarify. Every task has an owner and a clear deadline.</Quiet> : (
              <ul className="divide-y divide-rule">
                {toAnswer.map(c => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5"><Status tone="ask">{Q_LABEL[c.kind] ?? 'Question'}</Status><Refs ids={c.segment_ids.slice(0, 2)} segs={segs} names={names} show={show} /></div>
                    <p className="mt-0.5 text-ink">{c.question}</p>
                  </li>))}
                {m.open_questions.map(q => (
                  <li key={`q${q.id}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5"><Status tone="neutral">Raised in the meeting</Status><Refs ids={q.evidence_segment_ids} segs={segs} names={names} show={show} /></div>
                    <p className="mt-0.5 text-ink">{q.text}</p>
                  </li>))}
              </ul>
            )}
          </Block>

          <section aria-label="More about this meeting" className="border-t border-rule pt-6">
            <Tabs label="More about this meeting" value={more} onChange={setMore} tabs={[
              { key: 'speakers', label: `Speakers (${m.participants.length})` }, { key: 'share', label: 'Share summary' }, { key: 'technical', label: 'Technical details' }]} />
            {more === 'speakers' && <SpeakersTab m={m} onSaved={() => { void reload(); void actions.reload() }} />}
            {more === 'share' && <SummaryShare meetingId={m.id} />}
            {more === 'technical' && <TechnicalDetails m={m} show={show} />}
          </section>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
          {m.change_set && (
            <div className="rounded-lg border border-rule bg-panel p-4">
              <h2 className="text-[14px] font-semibold text-ink">{pendingCs ? 'Next: review and approve' : m.change_set.state === 'APPLIED' ? 'Approved' : 'Review'}</h2>
              <p className="mt-1 text-[13.5px] text-slate">{pendingCs
                ? `${plural(tasks.length, 'action item')}${toAnswer.length ? `, ${plural(toAnswer.length, 'question')} to answer first` : ', ready to approve'}. Nothing reaches the task board until you approve it.`
                : m.change_set.state === 'APPLIED' ? 'These tasks are on the task board.' : 'These proposals were not approved.'}</p>
              <div className="mt-3 [&>a]:w-full [&>a]:justify-center">{reviewBtn}</div>
            </div>
          )}
          <dl className="space-y-2.5 text-[13.5px]">
            {[
              ['Date', `${fmtDate(m.scheduled_at)}, ${m.timezone}`],
              ['Source', isAudio ? `Recording${m.stt_provider ? `, transcribed by ${m.stt_provider}` : ''}` : m.source_type ? 'Imported transcript' : 'Nothing uploaded'],
              ['Speakers', m.participants.map(p => p.display_name || p.speaker_label).join(', ') || 'None yet'],
              ['Consent', m.consent_confirmed ? 'Confirmed by the organiser' : 'Not confirmed'],
            ].map(([k, v]) => <div key={k}><dt className="text-faint">{k}</dt><dd className="text-ink">{v}</dd></div>)}
          </dl>
          <p className="text-[12.5px] text-faint">Every summary item, decision and task links to the transcript lines it came from. Select a speaker and time to see the line.</p>
        </aside>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Transcript" sub={m.title} width={640}>
        {audioUrl && <audio ref={audio} controls preload="metadata" src={audioUrl} className="mb-2 h-9 w-full" aria-label="Meeting recording" />}
        <Transcript segments={m.segments} names={names} focus={focus} audio={audio} hasAudio={!!audioUrl} />
        <p className="mt-2 text-[12.5px] text-faint">Timestamps are per segment, not per word.</p>
      </Drawer>
      {dialogs}
    </>
  )
}

function ActionTable({ rows, segs, names, show }: { rows: Planned[]; segs: Segs; names: Names; show: (k: string) => void }) {
  if (!rows.length) return <div className="rounded-lg border border-rule bg-panel"><Quiet>No action items were found in this meeting.</Quiet></div>
  const dep = (p: Planned) => p.item.depends_on.map(d => d.existing_task_id ? `${d.existing_task_id} ${d.title}` : d.title).join(', ')
  const prio = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '—')
  const due = (p: Planned) => p.item.deadline.date ? fmtDate(p.item.deadline.date) : <span className="text-faint">{p.item.deadline.raw ? `“${p.item.deadline.raw}”` : 'No date'}</span>
  const state = (p: Planned) => p.group === 'apply' && p.status.label === 'Will apply' ? p.action : p.status.label
  return (
    <div className="rounded-lg border border-rule bg-panel">
      {/* Phones: one block per action item instead of a table that scrolls sideways. */}
      <ul className="divide-y divide-rule md:hidden">{rows.map(p => (
        <li key={p.item.key} className="px-4 py-3">
          <div className="font-medium text-ink">{p.item.existing_task_id && <span className="tnum mr-1.5 font-normal text-faint">{p.item.existing_task_id}</span>}{p.item.title}</div>
          <dl className="mt-1 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-0.5 text-[13.5px]">
            <dt className="text-faint">Owner</dt><dd className="text-ink">{p.item.owner ?? <span className="text-faint">Unassigned</span>}</dd>
            <dt className="text-faint">Due</dt><dd className="tnum text-ink">{due(p)}</dd>
            <dt className="text-faint">Priority</dt><dd className="text-ink">{prio(p.item.priority.value)}</dd>
            <dt className="text-faint">Dependency</dt><dd className="text-slate">{dep(p) || '—'}</dd>
          </dl>
          <div className="mt-1 flex flex-wrap items-center gap-x-3"><Status tone={p.status.tone}>{state(p)}</Status><Refs ids={p.item.evidence_segment_ids.slice(0, 1)} segs={segs} names={names} show={show} /></div>
        </li>))}
      </ul>
      <table className="hidden w-full text-left text-[14px] md:table">
        <thead className="text-[12.5px] text-faint">
          <tr className="border-b border-rule"><th className="py-2 pl-4 pr-3 font-medium">Task</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 pr-3 font-medium">Due</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-4 font-medium">Dependency</th></tr>
        </thead>
        <tbody>{rows.map(p => (
          <tr key={p.item.key} className="border-b border-rule align-top last:border-b-0">
            <td className="py-3 pl-4 pr-3">
              <div className="font-medium text-ink">{p.item.existing_task_id && <span className="tnum mr-1.5 font-normal text-faint">{p.item.existing_task_id}</span>}{p.item.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5"><Status tone={p.status.tone}>{state(p)}</Status>
                <Refs ids={p.item.evidence_segment_ids.slice(0, 1)} segs={segs} names={names} show={show} /></div>
            </td>
            <td className="py-3 pr-3 text-ink">{p.item.owner ?? <span className="text-faint">Unassigned</span>}</td>
            <td className="tnum py-3 pr-3 text-ink">{due(p)}</td>
            <td className="py-3 pr-3 text-ink">{prio(p.item.priority.value)}</td>
            <td className="py-3 pr-4 text-slate">{dep(p) || '—'}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  )
}

// ---- secondary sections ------------------------------------------------------------------------------

function SpeakerRow({ p, meetingId, onSaved }: { p: Participant; meetingId: number; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(p.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = name.trim() !== (p.display_name ?? '') || !p.confirmed_identity
  async function save() {
    setBusy(true)
    try {
      const r = await api.put<{ change_set_recomputed: boolean }>(`/api/meetings/${meetingId}/participants/${encodeURIComponent(p.speaker_label)}`, { display_name: name.trim() || null, confirmed_identity: true })
      toast('ok', `${p.speaker_label} is now ${name.trim()}.${r.change_set_recomputed ? ' The proposed changes were re-checked without calling the model.' : ''}`)
      onSaved()
    } catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <span className="w-28 shrink-0 truncate text-[13.5px] text-slate" title={p.speaker_label}>{p.speaker_label}</span>
      <input aria-label={`Name for ${p.speaker_label}`} className={`${inputCls} min-w-0 max-w-[14rem] flex-1`} placeholder="Who is this?" value={name} onChange={e => setName(e.target.value)} />
      <Button size="sm" onClick={save} loading={busy} disabled={!dirty || !name.trim()}>{p.confirmed_identity ? 'Rename' : 'Confirm'}</Button>
      <span className="basis-full pl-[7.75rem] text-[12.5px]">
        {p.confirmed_identity ? <span className="text-done">Confirmed by you</span>
          : p.anonymous_label ? <span className="text-ask">Anonymous speaker label, not linked to a person</span>
          : <span className="text-faint">Name taken from the transcript, not yet confirmed</span>}
      </span>
    </li>
  )
}

function SpeakersTab({ m, onSaved }: { m: MeetingDetail; onSaved: () => void }) {
  return (
    <>
      <p className="mb-2 text-[13.5px] text-slate">“I will…” is only turned into an owner once you confirm who the speaker is. Confirming or renaming re-checks the proposed changes without calling the model.</p>
      {!m.participants.length ? <Empty>No speakers yet.</Empty> : <ul className="divide-y divide-rule border-y border-rule">{m.participants.map(p => <SpeakerRow key={p.speaker_label} p={p} meetingId={m.id} onSaved={onSaved} />)}</ul>}
    </>
  )
}

function TechnicalDetails({ m, show }: { m: MeetingDetail; show: (k: string) => void }) {
  const [events, setEvents] = useState(false)
  return (
    <div className="space-y-7">
      <Section title="Steps">
        {!m.processing_log.length ? <p className="text-faint">Not processed yet.</p> : (
          <ol className="divide-y divide-rule border-y border-rule text-[13.5px]">{m.processing_log.map((l, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-2"><span className="tnum w-28 shrink-0 text-faint">{fmtDateTime(l.at)}</span>
              <span className="text-ink">{STEP[l.step] ?? l.step}</span><span className={l.status === 'ok' ? 'text-done' : 'text-cancel'}>{l.status === 'ok' ? 'done' : l.status}</span>
              {l.detail && <span className="text-slate">{l.detail}</span>}</li>))}
          </ol>
        )}
      </Section>
      <Section title="Model calls" count={m.llm_runs.length}>
        {!m.llm_runs.length ? <p className="text-faint">No model calls yet.</p> : (
          <table className="w-full text-[13.5px]">
            <thead className="text-faint"><tr className="border-b border-rule"><th className="py-1.5 text-left font-medium">Call</th><th className="text-left font-medium">Model</th><th className="text-right font-medium">Time</th><th className="hidden text-right font-medium sm:table-cell">When</th></tr></thead>
            <tbody>{m.llm_runs.map(r => (
              <tr key={r.id} className="border-b border-rule"><td className="py-1.5">{r.purpose.replace(/_/g, ' ')}{r.error && <span className="ml-1 text-cancel">failed</span>}</td><td>{r.provider}/{r.model}</td>
                <td className="tnum text-right">{(r.latency_ms / 1000).toFixed(1)} s</td><td className="hidden text-right text-faint sm:table-cell">{fmtDateTime(r.created_at)}</td></tr>))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Interpreted events" count={m.events.length} actions={m.events.length > 0 && <Button kind="link" onClick={() => setEvents(!events)}>{events ? 'Hide events' : 'Show events'}</Button>}>
        <p className="text-[13.5px] text-slate">The model only describes what was said, as ordered events. Rules on the server turn them into proposed changes.</p>
        {events && (
          <ol className="mt-2 divide-y divide-rule border-y border-rule text-[13px]">{m.events.map(e => (
            <li key={e.seq} className="flex flex-wrap items-baseline gap-x-2.5 py-1.5">
              <span className={e.interpretation_status === 'valid' ? 'font-medium text-ink' : 'font-medium text-cancel'}>{e.type}</span>
              <span className="text-slate">{e.task_key}</span>
              <span className="text-faint">{['owner', 'deadline_text', 'strength', 'cancel_scope', 'depends_on_key'].filter(k => e.payload[k]).map(k => `${k}: ${e.payload[k]}`).join('; ')}</span>
              {e.segment_ids.map(k => <button key={k} type="button" onClick={() => show(k)} className="text-sky hover:underline">{k}</button>)}
              {e.rejection_reason && <span className="text-cancel">{e.rejection_reason}</span>}
            </li>))}
          </ol>
        )}
      </Section>
    </div>
  )
}

interface Share { id: number; content: string; content_hash: string; state: string; channel: string; recipients: string[]; error: string | null }

function SummaryShare({ meetingId }: { meetingId: number }) {
  const toast = useToast()
  const { data, reload } = useLoad(() => api.get<Share[]>(`/api/meetings/${meetingId}/summaries`), [meetingId])
  const [recipients, setRecipients] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = data?.[0]
  async function run(fn: () => Promise<unknown>, ok: (s: Share | undefined) => string) {
    setBusy(true)
    try { await fn(); const d = await reload(); toast('ok', ok(d?.[0])) } catch (e) { toast('error', e instanceof ApiError ? e.message : String(e)) } finally { setBusy(false) }
  }
  const approve = (channel: 'copy' | 'email') => latest && run(() => api.post(`/api/summaries/${latest.id}/approve`, {
    channel, content_hash: latest.content_hash, recipients: channel === 'email' ? recipients.split(',').map(s => s.trim()).filter(Boolean) : [],
  }), s => channel === 'copy' ? 'Copied to the clipboard and marked approved. Nothing was sent.'
    : s?.state === 'sent' ? 'Email sent.' : `Approved, but the email was NOT sent: ${s?.error ?? 'see the status below'}.`)
  const stateText = (s: Share) => s.state === 'sent' ? 'Email sent' : s.state === 'failed' ? 'Email failed; not sent'
    : s.state === 'approved' ? (s.channel === 'email' ? 'Approved for email, NOT sent' : 'Approved for copying; not sent anywhere') : 'Prepared, not approved'
  return (
    <Section title="Share the summary" actions={<Button size="sm" loading={busy && !latest} onClick={() => run(() => api.post(`/api/meetings/${meetingId}/summary`), () => 'Summary prepared from the approved decisions and tasks.')}>{latest ? 'Prepare again' : 'Prepare summary'}</Button>}>
      {!latest ? <p className="text-slate">Prepare a summary from the approved decisions and tasks. Nothing is sent until you approve it.</p> : (
        <div className="space-y-3">
          <Status tone={latest.state === 'sent' ? 'done' : latest.state === 'failed' || (latest.state === 'approved' && latest.channel === 'email') ? 'cancel' : 'neutral'}>{stateText(latest)}</Status>
          {latest.error && <p className="text-[13px] text-slate">{latest.error}</p>}
          <pre className="scroll-quiet max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-panel-2 p-3 text-[13px] text-ink">{latest.content}</pre>
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" disabled={busy} onClick={() => { void navigator.clipboard?.writeText(latest.content); void approve('copy') }}>Copy and mark approved</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1"><Field label="Email recipients (comma-separated)" hint="Email is only sent if the server has SMTP configured."><input className={inputCls} value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="name@example.com" /></Field></div>
            <Button onClick={() => approve('email')} disabled={busy || !recipients.trim()}>Approve and send</Button>
          </div>
        </div>
      )}
    </Section>
  )
}
