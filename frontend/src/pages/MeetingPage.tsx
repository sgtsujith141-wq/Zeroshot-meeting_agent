import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtDateTime } from '../lib/api'
import type { ChangeSet, MeetingDetail, Participant, Task } from '../types'
import {
  Button, Dialog, Empty, ErrorBox, Field, Loading, Menu, Notice, PageHeader, SegRef, Section, Status, Tabs,
  errText, inputCls, plural, useLoad, useToast,
} from '../components/ui'
import Transcript, { type Focus } from '../components/Transcript'
import { BUSY, meetingStatus } from '../lib/status'
import { plan } from '../lib/changes'

const STEP: Record<string, string> = { queue: 'Queued', transcribe: 'Speech to text', interpret: 'Interpretation', minutes: 'Minutes', changeset: 'Proposed changes', recover: 'Recovery' }
type Tab = 'transcript' | 'summary' | 'actions' | 'speakers' | 'processing'

function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => { const m = window.matchMedia(q); const h = () => setWide(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return wide
}

export default function MeetingPage() {
  const { id } = useParams()
  const mid = Number(id)
  const nav = useNavigate()
  const toast = useToast()
  const wide = useWide()
  const { data: m, error, loading, reload } = useLoad(() => api.get<MeetingDetail>(`/api/meetings/${mid}`), [mid],
    d => (d && BUSY.includes(d.processing_status) ? 3000 : undefined))
  const [tab, setTab] = useState<Tab>('summary')
  const [focus, setFocus] = useState<Focus | null>(null)
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
    if (k && m?.segments.length) { if (!wide) setTab('transcript'); setFocus({ key: k, n: Date.now() }) }
  }, [m?.segments.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wide && tab === 'transcript') setTab('summary') }, [wide, tab])

  if (loading && !m) return <Loading />
  if (!m) return <><PageHeader title="Meeting" crumbs={[{ label: 'Meetings', to: '/meetings' }]} /><ErrorBox error={error} onRetry={reload} /></>
  const names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  const segs = Object.fromEntries(m.segments.map(s => [s.seg_key, s]))
  const working = BUSY.includes(m.processing_status)
  const st = meetingStatus({ ...m, change_set: m.change_set })
  const show = (k: string) => { if (!wide) setTab('transcript'); setFocus({ key: k, n: Date.now() }) }
  const isAudio = m.source_type === 'audio' || m.source_type === 'video'
  const pendingCs = m.change_set && ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(m.change_set.state)

  async function rerun() {
    setBusy(true)
    try { await api.post(`/api/meetings/${mid}/process`, { steps: ['interpret', 'minutes'] }); setConfirm(null); toast('info', 'Analysis queued. This page refreshes while it runs.'); await reload() }
    catch (e) { setConfirm(null); toast('error', errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try { await api.del(`/api/meetings/${mid}`); toast('ok', `“${m!.title}” was deleted.`); nav('/meetings') }
    catch (e) { setConfirm(null); toast('error', errText(e)) } finally { setBusy(false) }
  }

  const transcript = (
    <div className="min-w-0">
      {audioUrl && <audio ref={audio} controls preload="metadata" src={audioUrl} className="mb-2 h-9 w-full" aria-label="Meeting recording" />}
      <Transcript segments={m.segments} names={names} focus={focus} audio={audio} hasAudio={!!audioUrl} maxHeight={wide ? 'calc(100vh - 13rem)' : undefined} />
      <p className="mt-2 text-[12.5px] text-faint">Timestamps are per segment, not per word.</p>
    </div>
  )
  const tabs: { key: Tab; label: string }[] = [
    ...(!wide ? [{ key: 'transcript' as Tab, label: `Transcript (${m.segments.length})` }] : []),
    { key: 'summary', label: 'Summary' }, { key: 'actions', label: 'Actions' }, { key: 'speakers', label: `Speakers (${m.participants.length})` }, { key: 'processing', label: 'Processing' },
  ]

  return (
    <>
      <PageHeader title={m.title} crumbs={[{ label: 'Meetings', to: '/meetings' }]}
        meta={<>
          <Status tone={st.tone} busy={st.busy}>{st.label}</Status>
          <span>{fmtDate(m.scheduled_at)}, {m.timezone}</span>
          <span>{isAudio ? `Recording${m.stt_provider ? `, transcribed by ${m.stt_provider}` : ''}` : m.source_type ? 'Imported transcript' : 'Nothing uploaded'}</span>
          <span>{m.consent_confirmed ? 'Consent confirmed by the organiser' : 'Consent not confirmed'}</span>
        </>}
        actions={<>
          {m.change_set && <Link to={`/approvals/${mid}`} className={`inline-flex h-8 items-center rounded-md px-3 text-[13.5px] font-medium ${pendingCs ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-rule-strong hover:bg-panel-2'}`}>{pendingCs ? 'Review proposed changes' : 'View approval'}</Link>}
          <Menu label="More" items={[
            { label: 'Re-run analysis', onSelect: () => setConfirm('rerun'), disabled: working || !m.segments.length },
            { label: 'Delete meeting', onSelect: () => setConfirm('delete'), danger: true, disabled: working },
          ]} />
        </>} />

      {(working || m.processing_error) && (
        <div className="mb-5">
          <Notice tone={working ? 'sky' : 'cancel'} role="status" title={working ? 'Processing' : 'Processing failed'}>
            {working ? 'Running the configured speech and language services. This page refreshes by itself.' : m.processing_error}
            <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px]">
              {m.processing_log.slice(-6).map((l, i) => <li key={i} className={l.status === 'ok' ? 'text-done' : 'text-cancel'}>{STEP[l.step] ?? l.step}: {l.status === 'ok' ? 'done' : l.status}</li>)}
            </ol>
          </Notice>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {wide && <div className="lg:sticky lg:top-6 lg:self-start"><h2 className="mb-2 text-[15px] font-semibold">Transcript <span className="font-normal text-faint tnum">{m.segments.length}</span></h2>{transcript}</div>}
        <div className="min-w-0">
          <Tabs label="Meeting sections" tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'transcript' && transcript}
          {tab === 'summary' && <SummaryTab m={m} names={names} segs={segs} show={show} />}
          {tab === 'actions' && <ActionsTab mid={mid} hasChangeSet={!!m.change_set} />}
          {tab === 'speakers' && <SpeakersTab m={m} onSaved={reload} />}
          {tab === 'processing' && <ProcessingTab m={m} show={show} />}
        </div>
      </div>

      <Dialog open={confirm === 'rerun'} onClose={() => setConfirm(null)} title="Re-run the analysis?"
        footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button kind="primary" loading={busy} onClick={rerun}>Re-run analysis</Button></>}>
        <p className="text-slate">This calls the configured language model again (several minutes with a local model) and recomputes the proposed changes. Approved meetings cannot be re-analysed.</p>
      </Dialog>
      <Dialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Delete this meeting?"
        footer={<><Button onClick={() => setConfirm(null)}>Keep it</Button><Button kind="danger" loading={busy} onClick={remove}>Delete meeting</Button></>}>
        <p className="text-slate">This removes the transcript, the uploaded recording, the minutes and any unapproved proposals for “{m.title}”. It cannot be undone. A meeting whose changes created approved tasks cannot be deleted.</p>
      </Dialog>
    </>
  )
}

// ---- tabs ----------------------------------------------------------------------------------------

type Segs = Record<string, MeetingDetail['segments'][number]>
function SummaryTab({ m, names, segs, show }: { m: MeetingDetail; names: Record<string, string | null>; segs: Segs; show: (k: string) => void }) {
  const reclassified = (m.minutes as { reclassified_as_actions?: unknown[] }).reclassified_as_actions?.length ?? 0
  return (
    <div className="space-y-7">
      <Section title="Minutes">
        {!m.minutes?.summary ? <p className="text-faint">Minutes appear after the meeting is processed.</p> : (
          <div className="space-y-3">
            <p className="text-ink">{m.minutes.summary}</p>
            {!!m.minutes.discussion?.length && (
              <ul className="space-y-2">{m.minutes.discussion.map((t, i) => (
                <li key={i}><span className="font-medium text-ink">{t.topic}.</span> <span className="text-slate">{t.summary}</span>{' '}
                  <span className="inline-flex flex-wrap gap-x-2">{t.segment_ids.map(k => <SegRef key={k} segKey={k} seg={segs[k]} name={names[segs[k]?.speaker_label]} onClick={() => show(k)} />)}</span></li>))}
              </ul>
            )}
            <p className="text-[12.5px] text-faint">Written by {m.minutes.generated_by}. {m.minutes.dropped_unsupported_items ? `${plural(m.minutes.dropped_unsupported_items, 'item')} without valid transcript evidence were discarded.` : 'Every item cites transcript evidence.'}{reclassified ? ` ${plural(reclassified, 'task assignment')} moved from decisions to actions.` : ''}</p>
          </div>
        )}
      </Section>
      <Section title="Decisions" count={m.decisions.length}>
        {!m.decisions.length ? <p className="text-faint">No decisions recorded.</p> : (
          <ul className="divide-y divide-rule border-y border-rule">{m.decisions.map(d => (
            <li key={d.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3"><span className="text-ink">{d.text}</span>
                <Status tone={d.approval_status === 'approved' ? 'done' : d.approval_status === 'rejected' ? 'neutral' : 'ask'}>{d.approval_status === 'approved' ? 'Approved' : d.approval_status === 'rejected' ? 'Not recorded' : 'Awaiting approval'}</Status></div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-slate"><span>{d.rationale ? `Reason given: ${d.rationale}` : 'No reason was given.'}</span>
                {d.evidence_segment_ids.map(k => <SegRef key={k} segKey={k} seg={segs[k]} name={names[segs[k]?.speaker_label]} onClick={() => show(k)} />)}</div>
            </li>))}
          </ul>
        )}
      </Section>
      <Section title="Unresolved questions" count={m.open_questions.length}>
        {!m.open_questions.length ? <p className="text-faint">None recorded.</p> : (
          <ul className="divide-y divide-rule border-y border-rule">{m.open_questions.map(q => (
            <li key={q.id} className="py-2.5"><span className="text-ink">{q.text}</span>{' '}
              <span className="inline-flex flex-wrap gap-x-2">{q.evidence_segment_ids.map(k => <SegRef key={k} segKey={k} seg={segs[k]} name={names[segs[k]?.speaker_label]} onClick={() => show(k)} />)}</span></li>))}
          </ul>
        )}
      </Section>
      <SummaryShare meetingId={m.id} />
    </div>
  )
}

function ActionsTab({ mid, hasChangeSet }: { mid: number; hasChangeSet: boolean }) {
  const { data, error, loading } = useLoad(async () => {
    if (!hasChangeSet) return null
    const [cs, board] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<Task[]>('/api/tasks')])
    return plan(cs, board)
  }, [mid, hasChangeSet])
  if (!hasChangeSet) return <Empty>No actions yet. They are extracted when the meeting is processed.</Empty>
  if (loading && !data) return <Loading rows={3} />
  return (
    <>
      <ErrorBox error={error} />
      <p className="mb-2 text-[13.5px] text-slate">Actions extracted from this meeting. Approve or adjust them on the <Link to={`/approvals/${mid}`} className="text-sky hover:underline">approval page</Link>.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead className="text-[12.5px] text-faint"><tr className="border-b border-rule"><th className="py-2 pr-4 font-medium">Action</th><th className="py-2 pr-4 font-medium">Owner</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Due</th><th className="py-2 font-medium">Status</th></tr></thead>
          <tbody>{(data ?? []).map(p => (
            <tr key={p.item.key} className="border-b border-rule">
              <td className="py-2 pr-4"><span className="text-ink">{p.item.title}</span><div className="text-[12.5px] text-faint">{p.item.existing_task_id ?? p.action}</div></td>
              <td className="py-2 pr-4 text-slate">{p.item.owner ?? 'Unassigned'}</td>
              <td className="tnum hidden py-2 pr-4 text-slate sm:table-cell">{p.item.deadline.date ? fmtDate(p.item.deadline.date) : '—'}</td>
              <td className="py-2"><Status tone={p.status.tone}>{p.status.label}</Status></td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </>
  )
}

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

function ProcessingTab({ m, show }: { m: MeetingDetail; show: (k: string) => void }) {
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
