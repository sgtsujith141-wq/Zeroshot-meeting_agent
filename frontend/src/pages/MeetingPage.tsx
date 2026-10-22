import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtDateTime, fmtTime } from '../lib/api'
import type { MeetingDetail, Participant } from '../types'
import { Button, Chip, ErrorBox, Loading, PageHeader, Panel, Quote, StateChip, inputCls, useLoad } from '../components/ui'

const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']

function SpeakerRow({ p, meetingId, onSaved }: { p: Participant; meetingId: number; onSaved: () => void }) {
  const [name, setName] = useState(p.display_name ?? '')
  const [err, setErr] = useState<string | null>(null)
  const dirty = name.trim() !== (p.display_name ?? '') || !p.confirmed_identity
  async function save() {
    try {
      await api.put(`/api/meetings/${meetingId}/participants/${encodeURIComponent(p.speaker_label)}`, { display_name: name.trim() || null, confirmed_identity: true })
      setErr(null); onSaved()
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)) }
  }
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 truncate text-[13.5px] text-slate" title={p.speaker_label}>{p.speaker_label}</span>
        <input aria-label={`Name for ${p.speaker_label}`} className={`${inputCls} max-w-[12rem]`} placeholder="Who is this?" value={name} onChange={e => setName(e.target.value)} />
        <Button onClick={save} disabled={!dirty || !name.trim()}>{p.confirmed_identity ? 'Rename' : 'Confirm'}</Button>
      </div>
      <div className="mt-0.5 pl-[7.5rem] text-[12.5px]">
        {p.confirmed_identity ? <span className="text-create">Confirmed by you</span>
          : p.anonymous_label ? <span className="text-ask">Anonymous speaker label; not linked to a person</span>
          : <span className="text-slate">Name taken from the transcript; not yet confirmed</span>}
      </div>
      {err && <p className="text-[13px] text-cancel">{err}</p>}
    </li>
  )
}

function SummaryShare({ meetingId }: { meetingId: number }) {
  const { data, reload } = useLoad(() => api.get<{ id: number; content: string; content_hash: string; state: string; channel: string; recipients: string[]; error: string | null }[]>(`/api/meetings/${meetingId}/summaries`), [meetingId])
  const [recipients, setRecipients] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const latest = data?.[0]
  async function prepare() { await api.post(`/api/meetings/${meetingId}/summary`); reload() }
  async function approve(channel: 'copy' | 'email') {
    if (!latest) return
    try {
      await api.post(`/api/summaries/${latest.id}/approve`, { channel, content_hash: latest.content_hash,
        recipients: channel === 'email' ? recipients.split(',').map(s => s.trim()).filter(Boolean) : [] })
      setErr(null); reload()
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)) }
  }
  return (
    <Panel title="Share the summary" actions={<Button onClick={prepare}>{latest ? 'Prepare again' : 'Prepare summary'}</Button>}>
      {!latest ? <p className="text-slate">Prepare a summary from the approved decisions and tasks. Nothing is sent until you approve it with recipients.</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><StateChip state={latest.state} />{latest.state === 'approved' && latest.channel === 'copy' && <span className="text-[13px] text-slate">Approved for copying; not sent anywhere.</span>}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-paper p-3 text-[13.5px]">{latest.content}</pre>
          {latest.error && <p className="text-[13.5px] text-ask">{latest.error}</p>}
          {err && <p className="text-[13.5px] text-cancel">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { navigator.clipboard?.writeText(latest.content); approve('copy') }}>Copy and mark approved</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1 text-[13.5px]">Email recipients (comma-separated)
              <input className={inputCls} value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="name@example.com" />
            </label>
            <Button onClick={() => approve('email')} disabled={!recipients.trim()}>Approve and send email</Button>
          </div>
          <p className="text-[12.5px] text-slate">Email is only sent when the server has SMTP configured; otherwise the summary is marked approved but not sent.</p>
        </div>
      )}
    </Panel>
  )
}

export default function MeetingPage() {
  const { id } = useParams()
  const mid = Number(id)
  const nav = useNavigate()
  const { data: m, error, loading, reload } = useLoad(() => api.get<MeetingDetail>(`/api/meetings/${mid}`), [mid],
    d => (d && BUSY.includes(d.processing_status) ? 3000 : undefined))
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showEvents, setShowEvents] = useState(false)

  useEffect(() => {
    if (m?.source_type === 'audio' || m?.source_type === 'video') {
      api.get<{ url: string }>(`/api/meetings/${mid}/media-url`).then(r => setAudioUrl(r.url)).catch(() => setAudioUrl(null))
    }
  }, [mid, m?.source_type])

  if (loading && !m) return <Loading />
  if (!m) return <ErrorBox error={error} onRetry={reload} />
  const names = Object.fromEntries(m.participants.map(p => [p.speaker_label, p.display_name]))
  const segs = Object.fromEntries(m.segments.map(s => [s.seg_key, s]))
  const busy = BUSY.includes(m.processing_status)

  async function run(steps: string[]) {
    try { await api.post(`/api/meetings/${mid}/process`, { steps }); setActionErr(null); reload() } catch (e) { setActionErr(e instanceof ApiError ? e.message : String(e)) }
  }
  async function remove() {
    if (!confirm('Delete this meeting, its transcript, uploaded file and unapproved proposals? This cannot be undone.')) return
    try { await api.del(`/api/meetings/${mid}`); nav('/') } catch (e) { setActionErr(e instanceof ApiError ? e.message : String(e)) }
  }

  return (
    <>
      <PageHeader title={m.title} sub={<>{fmtDate(m.scheduled_at)}, {m.timezone}. Organiser {m.organiser}. {m.consent_confirmed ? 'Consent confirmed by the organiser.' : 'Consent not confirmed.'}</>}>
        {m.change_set && <Link to={`/review/${mid}`} className="rounded-md bg-create px-3 py-1.5 text-[14px] font-medium text-white">Review changes</Link>}
        <Button onClick={() => run(['interpret', 'minutes'])} disabled={busy || !m.segments.length}>Re-run analysis</Button>
        <Button kind="danger" onClick={remove} disabled={busy}>Delete</Button>
      </PageHeader>
      <ErrorBox error={actionErr || error} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StateChip state={m.processing_status} />
        {busy && <span className="text-slate" aria-live="polite">Processing with the configured model; this page refreshes by itself.</span>}
        {m.processing_error && <span className="text-cancel">{m.processing_error}</span>}
        {m.llm_runs.length > 0 && <span className="text-[13px] text-slate">Model: {[...new Set(m.llm_runs.map(r => `${r.provider}/${r.model}`))].join(', ')}</span>}
        {m.stt_provider && <span className="text-[13px] text-slate">Transcribed by {m.stt_provider}</span>}
      </div>

      {audioUrl && <audio controls preload="metadata" src={audioUrl} className="mb-6 w-full" aria-label="Meeting recording" />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title={`Transcript (${m.segments.length} segments)`} actions={<span className="text-[12.5px] text-slate">Timestamps are per segment, not per word</span>}>
          {m.segments.length === 0 ? <p className="text-slate">No transcript yet.</p> : (
            <ol className="max-h-[70vh] space-y-3 overflow-auto pr-2">
              {m.segments.map(s => (
                <li key={s.seg_key} id={s.seg_key} className="scroll-mt-24 target:rounded target:bg-ask-soft">
                  <div className="text-[12.5px] text-slate">
                    <span className="font-medium text-ink">{names[s.speaker_label] && names[s.speaker_label] !== s.speaker_label ? `${names[s.speaker_label]} (${s.speaker_label})` : s.speaker_label}</span>
                    <span className="ml-2 tabular-nums">{fmtTime(s.start_seconds)}{s.end_seconds != null && `–${fmtTime(s.end_seconds)}`}</span>
                    <span className="ml-2">{s.seg_key}</span>
                    {s.revision > 1 && <span className="ml-2">corrected</span>}
                  </div>
                  <p className="spoken">{s.text}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Speakers">
            <p className="mb-1 text-[13.5px] text-slate">Owners are only inferred from “I will…” once you confirm who the speaker is. Changing a name re-checks the proposed changes without calling the model again.</p>
            <ul className="divide-y divide-rule">{m.participants.map(p => <SpeakerRow key={p.speaker_label} p={p} meetingId={mid} onSaved={reload} />)}</ul>
          </Panel>

          <Panel title="Minutes">
            {!m.minutes?.summary ? <p className="text-slate">Minutes appear after analysis.</p> : (
              <div className="space-y-4">
                <p>{m.minutes.summary}</p>
                {!!m.minutes.discussion?.length && (
                  <div><h3 className="mb-1 font-semibold">Discussion</h3>
                    <ul className="space-y-1.5">{m.minutes.discussion.map((t, i) => (
                      <li key={i}><span className="font-medium">{t.topic}.</span> {t.summary} {t.segment_ids.map(k => <a key={k} href={`#${k}`} className="ml-1 text-[12.5px] text-update hover:underline">{k}</a>)}</li>))}
                    </ul>
                  </div>
                )}
                <p className="text-[12.5px] text-slate">Generated by {m.minutes.generated_by}. {m.minutes.dropped_unsupported_items ? `${m.minutes.dropped_unsupported_items} item(s) without valid transcript evidence were discarded.` : 'Every item cites transcript evidence.'}</p>
              </div>
            )}
          </Panel>

          <Panel title={`Decisions (${m.decisions.length})`}>
            {m.decisions.length === 0 ? <p className="text-slate">No decisions recorded.</p> : (
              <ul className="space-y-4">{m.decisions.map(d => (
                <li key={d.id}>
                  <div className="flex items-start justify-between gap-2"><p className="font-medium">{d.text}</p><StateChip state={d.approval_status} /></div>
                  <p className="text-[14px] text-slate">{d.rationale ? <>Reason given: {d.rationale}</> : 'No reason was extracted; check the quote below.'}</p>
                  <div className="mt-2 space-y-2">{d.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={segs[k]} speakerName={names[segs[k]?.speaker_label]} />)}</div>
                </li>))}
              </ul>
            )}
          </Panel>

          <Panel title={`Unresolved questions (${m.open_questions.length})`}>
            {m.open_questions.length === 0 ? <p className="text-slate">None recorded.</p> : (
              <ul className="space-y-3">{m.open_questions.map(q => (
                <li key={q.id}><p>{q.text}</p><div className="mt-1 space-y-2">{q.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={segs[k]} speakerName={names[segs[k]?.speaker_label]} />)}</div></li>))}
              </ul>
            )}
          </Panel>

          <SummaryShare meetingId={mid} />

          <Panel title="How this meeting was interpreted" actions={<Button kind="quiet" onClick={() => setShowEvents(!showEvents)}>{showEvents ? 'Hide' : `Show ${m.events.length} events`}</Button>}>
            <p className="text-[13.5px] text-slate">The model only describes what was said, as ordered events. Rules in the server turn them into proposed changes.</p>
            {showEvents && (
              <ol className="mt-3 space-y-1.5 text-[13.5px]">
                {m.events.map(e => (
                  <li key={e.seq} className="flex flex-wrap gap-2">
                    <Chip tone={e.interpretation_status === 'valid' ? 'neutral' : 'cancel'}>{e.type}</Chip>
                    <span className="font-medium">{e.task_key}</span>
                    <span className="text-slate">{['owner', 'deadline_text', 'strength', 'cancel_scope', 'depends_on_key'].filter(k => e.payload[k]).map(k => `${k}: ${e.payload[k]}`).join('; ')}</span>
                    <span className="text-update">{e.segment_ids.join(', ')}</span>
                    {e.rejection_reason && <span className="text-cancel">{e.rejection_reason}</span>}
                  </li>))}
              </ol>
            )}
            {m.llm_runs.length > 0 && (
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-slate"><tr><th className="text-left font-medium">Call</th><th className="text-left font-medium">Model</th><th className="text-right font-medium">Time</th><th className="text-right font-medium">When</th></tr></thead>
                <tbody>{m.llm_runs.map(r => (
                  <tr key={r.id}><td>{r.purpose}{r.error && <span className="ml-1 text-cancel">failed</span>}</td><td>{r.provider}/{r.model}</td><td className="text-right tabular-nums">{(r.latency_ms / 1000).toFixed(1)} s</td><td className="text-right">{fmtDateTime(r.created_at)}</td></tr>))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
