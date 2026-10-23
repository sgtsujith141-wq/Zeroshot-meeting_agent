import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CheckCircle2, ChevronRight, ClipboardCheck, Copy, FileAudio, FileText, ListTree, Mail, MessageSquareQuote, RefreshCw,
  Share2, Sparkles, Trash2, Users, XCircle,
} from 'lucide-react'
import { api, fmtDate, fmtDateTime } from '../lib/api'
import type { MeetingDetail, Participant } from '../types'
import {
  Avatar, Button, Chip, Dialog, ErrorBox, Field, Loading, Notice, PageHeader, Panel, Quote, Spinner, StateChip,
  errText, inputCls, useLoad, useToast,
} from '../components/ui'
import Transcript, { type Focus } from '../components/Transcript'

const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']
const STEP_LABEL: Record<string, string> = {
  queue: 'Queued', transcribe: 'Speech to text', interpret: 'Interpretation', minutes: 'Minutes', changeset: 'Proposed changes', recover: 'Recovery',
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
      toast('ok', `${p.speaker_label} is now ${name.trim()}.${r.change_set_recomputed ? ' Proposals re-checked without calling the model.' : ''}`)
      onSaved()
    } catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={p.display_name} size={24} />
        <span className="w-24 shrink-0 truncate text-[13px] text-slate" title={p.speaker_label}>{p.speaker_label}</span>
        <input aria-label={`Name for ${p.speaker_label}`} className={`${inputCls} h-8 min-w-0 max-w-[12rem] flex-1`} placeholder="Who is this?" value={name} onChange={e => setName(e.target.value)} />
        <Button size="sm" onClick={save} loading={busy} disabled={!dirty || !name.trim()}>{p.confirmed_identity ? 'Rename' : 'Confirm'}</Button>
      </div>
      <div className="mt-1 pl-8 text-[12.5px]">
        {p.confirmed_identity ? <span className="text-done">Confirmed by you</span>
          : p.anonymous_label ? <span className="text-ask">Anonymous speaker label, not linked to a person</span>
          : <span className="text-faint">Name taken from the transcript, not yet confirmed</span>}
      </div>
    </li>
  )
}

interface Share { id: number; content: string; content_hash: string; state: string; channel: string; recipients: string[]; error: string | null }

function SummaryShare({ meetingId }: { meetingId: number }) {
  const toast = useToast()
  const { data, reload } = useLoad(() => api.get<Share[]>(`/api/meetings/${meetingId}/summaries`), [meetingId])
  const [recipients, setRecipients] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = data?.[0]
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try { await fn(); await reload(); toast('ok', ok) } catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  const approve = (channel: 'copy' | 'email') => latest && run(() => api.post(`/api/summaries/${latest.id}/approve`, {
    channel, content_hash: latest.content_hash, recipients: channel === 'email' ? recipients.split(',').map(s => s.trim()).filter(Boolean) : [],
  }), channel === 'copy' ? 'Copied to the clipboard and marked approved. Nothing was sent.' : 'Approved for email. See the status below for whether it was sent.')
  return (
    <Panel title="Share the summary" icon={<Share2 size={15} />}
      actions={<Button size="sm" loading={busy && !latest} onClick={() => run(() => api.post(`/api/meetings/${meetingId}/summary`), 'Summary prepared from the approved decisions and tasks.')}>{latest ? 'Prepare again' : 'Prepare summary'}</Button>}>
      {!latest ? <p className="text-[14px] text-slate">Prepare a summary from the approved decisions and tasks. Nothing is sent until you approve it with recipients.</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><StateChip state={latest.state} />
            {latest.state === 'approved' && latest.channel === 'copy' && <span className="text-[13px] text-faint">Approved for copying; not sent anywhere.</span>}</div>
          <pre className="scroll-quiet max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-rule bg-panel-2 p-3 text-[13px] text-ink">{latest.content}</pre>
          {latest.error && <Notice tone="ask">{latest.error}</Notice>}
          <Button size="sm" icon={<Copy size={14} />} disabled={busy} onClick={() => { void navigator.clipboard?.writeText(latest.content); void approve('copy') }}>Copy and mark approved</Button>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1"><Field label="Email recipients (comma-separated)"><input className={inputCls} value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="name@example.com" /></Field></div>
            <Button icon={<Mail size={14} />} onClick={() => approve('email')} disabled={busy || !recipients.trim()}>Approve and send</Button>
          </div>
          <p className="text-[12.5px] text-faint">Email is only sent when the server has SMTP configured; otherwise the summary is marked approved but not sent.</p>
        </div>
      )}
    </Panel>
  )
}

export default function MeetingPage() {
  const { id } = useParams()
  const mid = Number(id)
  const nav = useNavigate()
  const toast = useToast()
  const { data: m, error, loading, reload } = useLoad(() => api.get<MeetingDetail>(`/api/meetings/${mid}`), [mid],
    d => (d && BUSY.includes(d.processing_status) ? 3000 : undefined))
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [showEvents, setShowEvents] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (m?.source_type === 'audio' || m?.source_type === 'video') {
      api.get<{ url: string }>(`/api/meetings/${mid}/media-url`).then(r => setAudioUrl(r.url)).catch(() => setAudioUrl(null))
    }
  }, [mid, m?.source_type])
  useEffect(() => { // honour #s12 links from other pages
    const k = location.hash.slice(1)
    if (k && m?.segments.length) setFocus({ key: k, n: Date.now() })
  }, [m?.segments.length])

  if (loading && !m) return <Loading rows={4} />
  if (!m) return <ErrorBox error={error} onRetry={reload} />
  const names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  const segs = Object.fromEntries(m.segments.map(s => [s.seg_key, s]))
  const working = BUSY.includes(m.processing_status)
  const isAudio = m.source_type === 'audio' || m.source_type === 'video'
  const models = [...new Set(m.llm_runs.map(r => `${r.provider}/${r.model}`))]
  const jump = (k: string) => setFocus({ key: k, n: Date.now() })

  async function run(steps: string[]) {
    setBusy(true)
    try { await api.post(`/api/meetings/${mid}/process`, { steps }); toast('info', 'Analysis queued. This page refreshes while it runs.'); await reload() }
    catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try { await api.del(`/api/meetings/${mid}`); toast('ok', 'Meeting deleted.'); nav('/') }
    catch (e) { toast('error', errText(e)); setConfirmDelete(false) } finally { setBusy(false) }
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-[13px] text-faint"><Link to="/" className="shrink-0 hover:text-ink">Overview</Link><ChevronRight size={13} aria-hidden className="shrink-0" /><span className="min-w-0 truncate" aria-current="page">Meeting</span></nav>
      <PageHeader title={m.title}
        sub={<>{fmtDate(m.scheduled_at)}, {m.timezone}. Organiser {m.organiser}. {m.consent_confirmed ? 'Consent confirmed by the organiser.' : 'Consent not confirmed.'}</>}
        meta={<>
          <StateChip state={m.processing_status} />
          <Chip icon={isAudio ? <FileAudio size={12} /> : <FileText size={12} />}>{isAudio ? `Audio${m.stt_provider ? `, transcribed by ${m.stt_provider}` : ''}` : m.source_type ? 'Imported transcript' : 'Nothing uploaded'}</Chip>
          {models.length > 0 && <Chip icon={<Sparkles size={12} />}>{models.join(', ')}</Chip>}
          {m.segments.length > 0 && <span className="text-[12.5px] text-faint">{m.segments.length} segments</span>}
        </>}>
        {m.change_set && <Link to={`/review/${mid}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13.5px] font-medium text-on-accent hover:bg-accent-hover"><ClipboardCheck size={15} />Review changes</Link>}
        <Button icon={<RefreshCw size={14} />} loading={busy && !confirmDelete} onClick={() => run(['interpret', 'minutes'])} disabled={working || !m.segments.length}>Re-run analysis</Button>
        <Button kind="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)} disabled={working}>Delete</Button>
      </PageHeader>
      <ErrorBox error={error} />

      {(working || m.processing_error) && (
        <div className="mb-5 rounded-xl border border-rule bg-panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            {working ? <><Spinner /><span className="text-ink">Processing with the configured model and speech service. This page refreshes by itself.</span></>
              : <><XCircle size={16} className="text-cancel" /><span className="text-ink">{m.processing_error}</span></>}
          </div>
          <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-faint">
            {m.processing_log.slice(-6).map((l, i) => (
              <li key={i} className="inline-flex items-center gap-1">
                {l.status === 'ok' ? <CheckCircle2 size={12} className="text-done" /> : <XCircle size={12} className="text-cancel" />}{STEP_LABEL[l.step] ?? l.step}
              </li>))}
          </ol>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-rule bg-panel shadow-soft">
            <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold"><MessageSquareQuote size={15} className="text-faint" />Transcript ({m.segments.length} segments)</h2>
              <span className="hidden text-[12px] text-faint sm:inline">Timestamps per segment, not per word</span>
            </div>
            {audioUrl && <div className="border-b border-rule px-3 py-2"><audio ref={audio} controls preload="metadata" src={audioUrl} className="h-9 w-full" aria-label="Meeting recording" /></div>}
            <Transcript segments={m.segments} names={names} focus={focus} audio={audio} hasAudio={!!audioUrl} maxHeight="calc(100vh - 15rem)" />
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel title="Speakers" icon={<Users size={15} />}>
            <p className="text-[13px] text-slate">Owners are only inferred from “I will…” once you confirm who the speaker is. Renaming re-checks the proposed changes without calling the model again.</p>
            <ul className="divide-y divide-rule">{m.participants.map(p => <SpeakerRow key={p.speaker_label} p={p} meetingId={mid} onSaved={reload} />)}</ul>
          </Panel>

          <Panel title="Minutes" icon={<FileText size={15} />}>
            {!m.minutes?.summary ? <p className="text-[14px] text-faint">Minutes appear after analysis.</p> : (
              <div className="space-y-4 text-[14.5px]">
                <p className="text-ink">{m.minutes.summary}</p>
                {!!m.minutes.discussion?.length && (
                  <div><h3 className="mb-1.5 text-[13px] font-semibold text-slate">Discussion</h3>
                    <ul className="space-y-2">{m.minutes.discussion.map((t, i) => (
                      <li key={i}><span className="font-medium">{t.topic}.</span> <span className="text-slate">{t.summary}</span>{' '}
                        {t.segment_ids.map(k => <button key={k} onClick={() => jump(k)} className="ml-1 text-[12.5px] text-sky hover:underline">{k}</button>)}</li>))}
                    </ul>
                  </div>
                )}
                <p className="text-[12.5px] text-faint">Generated by {m.minutes.generated_by}. {m.minutes.dropped_unsupported_items ? `${m.minutes.dropped_unsupported_items} item(s) without valid transcript evidence were discarded.` : 'Every item cites transcript evidence.'}
                  {(m.minutes as { reclassified_as_actions?: unknown[] }).reclassified_as_actions?.length ? ` ${(m.minutes as { reclassified_as_actions: unknown[] }).reclassified_as_actions.length} task assignment(s) were moved from decisions to actions.` : ''}</p>
              </div>
            )}
          </Panel>

          <Panel title={<>Decisions <span className="ml-1 font-normal text-faint tnum">{m.decisions.length}</span></>} icon={<CheckCircle2 size={15} />}>
            {m.decisions.length === 0 ? <p className="text-[14px] text-faint">No decisions recorded.</p> : (
              <ul className="space-y-4">{m.decisions.map(d => (
                <li key={d.id}>
                  <div className="flex items-start justify-between gap-2"><p className="font-medium">{d.text}</p><StateChip state={d.approval_status} /></div>
                  <p className="text-[13.5px] text-slate">{d.rationale ? <>Reason given: {d.rationale}</> : 'No reason was extracted; check the quote below.'}</p>
                  <div className="mt-2 space-y-2">{d.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={segs[k]} speakerName={names[segs[k]?.speaker_label]} onFocus={jump} />)}</div>
                </li>))}
              </ul>
            )}
          </Panel>

          <Panel title={<>Unresolved questions <span className="ml-1 font-normal text-faint tnum">{m.open_questions.length}</span></>}>
            {m.open_questions.length === 0 ? <p className="text-[14px] text-faint">None recorded.</p> : (
              <ul className="space-y-3">{m.open_questions.map(q => (
                <li key={q.id}><p>{q.text}</p><div className="mt-1.5 space-y-2">{q.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={segs[k]} speakerName={names[segs[k]?.speaker_label]} onFocus={jump} />)}</div></li>))}
              </ul>
            )}
          </Panel>

          <SummaryShare meetingId={mid} />

          <Panel title="How this meeting was interpreted" icon={<ListTree size={15} />} actions={<Button kind="quiet" onClick={() => setShowEvents(!showEvents)}>{showEvents ? 'Hide events' : `Show ${m.events.length} events`}</Button>}>
            <p className="text-[13.5px] text-slate">The model only describes what was said, as ordered events. Rules in the server turn them into proposed changes.</p>
            {showEvents && (
              <ol className="mt-3 space-y-1.5 text-[13px]">
                {m.events.map(e => (
                  <li key={e.seq} className="flex flex-wrap items-center gap-2">
                    <Chip tone={e.interpretation_status === 'valid' ? 'neutral' : 'cancel'}>{e.type}</Chip>
                    <span className="font-medium">{e.task_key}</span>
                    <span className="text-slate">{['owner', 'deadline_text', 'strength', 'cancel_scope', 'depends_on_key'].filter(k => e.payload[k]).map(k => `${k}: ${e.payload[k]}`).join('; ')}</span>
                    {e.segment_ids.map(k => <button key={k} onClick={() => jump(k)} className="text-sky hover:underline">{k}</button>)}
                    {e.rejection_reason && <span className="text-cancel">{e.rejection_reason}</span>}
                  </li>))}
              </ol>
            )}
            {m.llm_runs.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-faint"><tr><th className="py-1 text-left font-medium">Call</th><th className="text-left font-medium">Model</th><th className="text-right font-medium">Time</th><th className="hidden text-right font-medium sm:table-cell">When</th></tr></thead>
                  <tbody>{m.llm_runs.map(r => (
                    <tr key={r.id} className="border-t border-rule"><td className="py-1">{r.purpose.replace(/_/g, ' ')}{r.error && <span className="ml-1 text-cancel">failed</span>}</td><td>{r.provider}/{r.model}</td><td className="tnum text-right">{(r.latency_ms / 1000).toFixed(1)} s</td><td className="hidden text-right text-faint sm:table-cell">{fmtDateTime(r.created_at)}</td></tr>))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this meeting?"
        footer={<><Button onClick={() => setConfirmDelete(false)}>Keep it</Button><Button kind="danger" loading={busy} icon={<Trash2 size={14} />} onClick={remove}>Delete meeting</Button></>}>
        <p className="text-slate">This removes the transcript, uploaded recording, minutes and any unapproved proposals for “{m.title}”. It cannot be undone. Meetings whose changes created approved tasks cannot be deleted.</p>
      </Dialog>
    </>
  )
}
