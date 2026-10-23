import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Info, RefreshCw } from 'lucide-react'
import { api, ApiError, fmtDate, fmtDateTime } from '../lib/api'
import type { ChangeSet, Clarification, MeetingDetail, MeetingSummary, Task, TaskDetail } from '../types'
import {
  Button, Dialog, Drawer, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Quote, SegRef, Section, Status, Tabs,
  errText, inputCls, plural, useLoad, useToast,
} from '../components/ui'
import Transcript, { type Focus } from '../components/Transcript'
import {
  OWNER_KINDS, Q_LABEL, actionFor, answerLabel, diffProposals, orphanAnswers, plan, revisionChanges, summarize,
  type FieldChange, type Orphan, type Planned,
} from '../lib/changes'
import { OPEN_TASK, changeSetStatus } from '../lib/status'

export default function ApprovalsPage() {
  const { meetingId } = useParams()
  return meetingId ? <Approval mid={Number(meetingId)} key={meetingId} /> : <ApprovalList />
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; version: number; items: number; open_questions: number; updated_at: string }

function ApprovalList() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'waiting' | 'all'>('waiting')
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, meetings] = await Promise.all([api.get<CsRow[]>('/api/changesets'), api.get<MeetingSummary[]>('/api/meetings')])
    return { rows, meetings: new Map(meetings.map(m => [m.id, m])) }
  })
  const waiting = (data?.rows ?? []).filter(r => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(r.state))
  const rows = tab === 'waiting' ? waiting : data?.rows ?? []
  return (
    <>
      <PageHeader title="Approvals" sub="Each processed meeting proposes changes to the task board. Nothing reaches the board until you approve it here." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.rows.length ? (
        <Empty action={<Link to="/meetings/new" className="font-medium text-sky hover:underline">Add a meeting</Link>}>
          No proposed changes yet. They appear here once a meeting has been processed.
        </Empty>
      ) : (
        <>
          <Tabs label="Show" value={tab} onChange={setTab} tabs={[{ key: 'waiting', label: <>Waiting <span className="text-faint tnum">{waiting.length}</span></> }, { key: 'all', label: <>All <span className="text-faint tnum">{data.rows.length}</span></> }]} />
          {!rows.length ? <Empty>Nothing is waiting for approval.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="text-[12.5px] text-faint">
                  <tr className="border-b border-rule">
                    <th className="py-2 pr-4 font-medium">Meeting</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Meeting date</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Proposed items</th><th className="py-2 pr-4 font-medium">Open questions</th><th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const st = changeSetStatus(r.state)
                    const m = data.meetings.get(r.meeting_id)
                    return (
                      <tr key={r.id} className="cursor-pointer border-b border-rule hover:bg-panel-2" onClick={() => nav(`/approvals/${r.meeting_id}`)}>
                        <td className="py-2.5 pr-4"><Link to={`/approvals/${r.meeting_id}`} className="font-medium text-ink hover:underline" onClick={e => e.stopPropagation()}>{r.meeting_title}</Link></td>
                        <td className="tnum hidden py-2.5 pr-4 text-slate sm:table-cell">{m ? fmtDate(m.scheduled_at) : '—'}</td>
                        <td className="tnum hidden py-2.5 pr-4 text-slate md:table-cell">{r.items}</td>
                        <td className="tnum py-2.5 pr-4 text-slate">{r.open_questions || '—'}</td>
                        <td className="py-2.5"><Status tone={st.tone}>{st.label}</Status></td>
                      </tr>)
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// One meeting's proposed changes
// ---------------------------------------------------------------------------------------------

interface Data { cs: ChangeSet; meeting: MeetingDetail; board: Task[] }
type ApplyResult = { created?: Record<string, string>; updated?: string[]; cancelled?: string[]; completed?: string[]; idempotent_replay?: boolean }
const describeResult = (r: ApplyResult) => {
  const c = Object.values(r.created ?? {})
  return [c.length && `created ${c.join(', ')}`, r.updated?.length && `updated ${r.updated.join(', ')}`,
    r.completed?.length && `marked ${r.completed.join(', ')} done`, r.cancelled?.length && `cancelled ${r.cancelled.join(', ')}`].filter(Boolean).join('; ')
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const qkey = (c: Clarification) => `${c.item_keys[0]}|${c.kind}`

interface Ctx {
  cs: ChangeSet; meeting: MeetingDetail; editable: boolean; busy: boolean
  names: Record<string, string | null>; people: string[]
  patch: (body: unknown) => Promise<boolean>
  mapSpeaker: (label: string, name: string) => Promise<boolean>
  show: (k: string) => void
  open: (key: string) => void
}

function Approval({ mid }: { mid: number }) {
  const toast = useToast()
  const { data, error, loading, reload, setData } = useLoad<Data>(async () => {
    const [cs, meeting, board] = await Promise.all([
      api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`), api.get<Task[]>('/api/tasks')])
    return { cs, meeting, board }
  }, [mid])
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ from: number; to: number; lines: string[] } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [transcript, setTranscript] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [applied, setApplied] = useState<Record<string, FieldChange[] | null>>({})
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const st = data?.meeting.source_type
    if (st === 'audio' || st === 'video') api.get<{ url: string }>(`/api/meetings/${mid}/media-url`).then(r => setAudioUrl(r.url)).catch(() => setAudioUrl(null))
  }, [mid, data?.meeting.source_type])

  // After approval, show what each task's recorded revision actually changed.
  const appliedCodes = useMemo(() => {
    const r = data?.cs.state === 'APPLIED' ? data.cs.applied_result : null
    return r ? [...Object.values(r.created ?? {}), ...(r.updated ?? []), ...(r.cancelled ?? []), ...(r.completed ?? [])] : []
  }, [data?.cs])
  useEffect(() => {
    if (!data || !appliedCodes.length) return
    Promise.all(appliedCodes.map(c => api.get<TaskDetail>(`/api/tasks/${c}`).then(t => [c, revisionChanges(t, data.cs.id)] as const).catch(() => [c, null] as const)))
      .then(rows => setApplied(Object.fromEntries(rows)))
  }, [appliedCodes, data?.cs.id])

  const derived = useMemo(() => {
    if (!data) return null
    const { cs, meeting, board } = data
    const live = ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW', 'DRAFT'].includes(cs.state)
    const excluded = new Set(cs.proposal.items.filter(i => i.excluded).map(i => i.key))
    const relevant = (c: Clarification) => !c.deferred && !(c.item_keys.length > 0 && c.item_keys.every(k => excluded.has(k)))
    const openNow = board.filter(t => OPEN_TASK.includes(t.status)).map(t => `${t.code}@${t.revision}`).sort().join()
    const checked = (cs.ledger_snapshot ?? []).map(t => `${t.code}@${t.revision}`).sort().join()
    return {
      live,
      planned: plan(cs, board),
      openQs: live ? cs.proposal.clarifications.filter(c => relevant(c) && !c.answer).sort((a, b) => a.rank - b.rank) : [],
      answered: cs.proposal.clarifications.filter(c => relevant(c) && c.answer),
      orphans: live ? orphanAnswers(cs) : [],
      boardMoved: live && openNow !== checked,
      names: Object.fromEntries(meeting.participants.map(p => [p.speaker_label, p.display_name])) as Record<string, string | null>,
      people: [...new Set([...meeting.participants.map(p => p.display_name), ...board.map(t => t.owner)].filter(Boolean) as string[])].sort(),
      segments: Object.entries(cs.segments).map(([seg_key, s]) => ({ seg_key, ...s })).sort((a, b) => a.start_seconds - b.start_seconds),
    }
  }, [data])

  if (loading && !data) return <Loading />
  if (!data || !derived) return <><PageHeader title="Approval" crumbs={[{ label: 'Approvals', to: '/approvals' }]} /><ErrorBox error={error} onRetry={reload} /></>
  const { cs, meeting } = data
  const editable = derived.live
  const stale = editable && (conflict || derived.boardMoved)

  /** Run an action that returns the new change set; list what it changed. */
  async function act(fn: () => Promise<ChangeSet>, ok?: string): Promise<boolean> {
    setBusy(true)
    const prev = data!.cs
    try {
      const next = await fn()
      setData(d => d && { ...d, cs: next })
      const lines = diffProposals(prev, next)
      setDiff(lines.length ? { from: prev.version, to: next.version, lines } : null)
      if (ok) toast('ok', ok)
      return true
    } catch (e) { toast('error', errText(e)); return false } finally { setBusy(false) }
  }
  const ctx: Ctx = {
    cs, meeting, editable, busy, names: derived.names, people: derived.people,
    patch: body => act(() => api.patch<ChangeSet>(`/api/changesets/${cs.id}`, body)),
    mapSpeaker: (label, name) => act(async () => {
      await api.put(`/api/meetings/${mid}/participants/${encodeURIComponent(label)}`, { display_name: name, confirmed_identity: true })
      const [next, m2] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`)])
      setData(d => d && { ...d, meeting: m2 })
      return next
    }, `${label} is now ${name}. The proposal was re-checked without calling the model.`),
    show: k => { setOpenKey(null); setTranscript(true); setFocus({ key: k, n: Date.now() }) },
    open: key => setOpenKey(key),
  }
  async function recheck() {
    const ok = await act(() => api.post<ChangeSet>(`/api/meetings/${mid}/changeset/recompute`), 'Re-checked against the current task board, without calling the model. Review the changes listed above, then approve.')
    if (ok) { setConflict(false); const board = await api.get<Task[]>('/api/tasks').catch(() => null); if (board) setData(d => d && { ...d, board }) }
  }
  async function approve() {
    setBusy(true)
    try {
      const r = await api.post<{ change_set: ChangeSet; result: ApplyResult }>(`/api/changesets/${cs.id}/approve`, { proposal_hash: cs.proposal_hash })
      setDiff(null)
      await reload() // show the board and change set exactly as the server now has them
      toast('ok', <>Approved{r.result.idempotent_replay ? ' (already applied; nothing was duplicated)' : ''}: {describeResult(r.result) || 'no task changes'}. <Link className="font-medium text-sky hover:underline" to="/tasks">Open tasks</Link></>)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /changed since it was reviewed/.test(e.message)) setConflict(true)
      toast('error', errText(e))
    } finally { setBusy(false) }
  }
  async function reject() {
    setBusy(true)
    try {
      await api.post(`/api/changesets/${cs.id}/reject`, { reason: reason.trim() || null })
      setRejectOpen(false); setDiff(null); await reload()
      toast('ok', 'Proposed changes rejected. Nothing was applied to the task board.')
    } catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }

  const planned = derived.planned
  const applying = planned.filter(p => p.group === 'apply')
  const waiting = planned.filter(p => p.group === 'waiting')
  const excludedRows = planned.filter(p => p.group === 'none' && p.item.excluded)
  const other = planned.filter(p => p.group === 'none' && !p.item.excluded)
  const openItem = openKey ? planned.find(p => p.item.key === openKey) ?? null : null
  const isAudio = meeting.source_type === 'audio' || meeting.source_type === 'video'
  const st = changeSetStatus(cs.state)
  const blockedBy = !editable ? null
    : stale ? 'Re-check against the current board first.'
    : derived.orphans.length ? `Decide on ${plural(derived.orphans.length, 'earlier answer')} that no longer ${derived.orphans.length === 1 ? 'applies' : 'apply'}.`
    : derived.openQs.length ? `Answer ${plural(derived.openQs.length, 'open question')}, or exclude ${derived.openQs.length === 1 ? 'its item' : 'their items'}.`
    : cs.state !== 'READY_FOR_REVIEW' ? 'Not ready for approval.' : null

  return (
    <div className="pb-24">
      <PageHeader title={meeting.title} crumbs={[{ label: 'Approvals', to: '/approvals' }]}
        sub="Proposed changes to the task board from this meeting. Nothing changes until you approve."
        meta={<>
          <Status tone={st.tone}>{st.label}</Status>
          <span>Meeting on {fmtDate(meeting.scheduled_at)}</span>
          <span>{isAudio ? `Recording, transcribed by ${meeting.stt_provider ?? 'unknown'}` : 'Imported transcript'}</span>
          <span>Version {cs.version}</span>
        </>}
        actions={<>
          <Button onClick={() => setTranscript(true)}>Transcript</Button>
          <Link to={`/meetings/${mid}`} className="inline-flex h-8 items-center rounded-md border border-rule-strong px-3 text-[13.5px] font-medium hover:bg-panel-2">Open meeting</Link>
        </>} />

      <div className="space-y-3">
        {cs.state === 'APPLIED' && (
          <Notice tone="done" title="Approved and applied">
            {cap(describeResult(cs.applied_result) || 'no task changes were needed')}. <Link className="font-medium text-sky hover:underline" to="/tasks">Open tasks</Link>
          </Notice>
        )}
        {cs.state === 'REJECTED' && <Notice tone="neutral" title="Rejected">These proposed changes were rejected. Nothing was applied to the task board.</Notice>}
        {cs.state === 'FAILED' && <Notice tone="cancel" title="Applying failed; nothing was written">{cs.error}</Notice>}
        {stale && (
          <Notice tone="ask" role="status" title={conflict ? 'This proposal changed on the server since you loaded it' : 'The task board changed after this proposal was checked'}
            actions={<Button size="sm" kind="primary" icon={<RefreshCw size={13} />} loading={busy} onClick={recheck}>Re-check against the current board</Button>}>
            {conflict ? 'Approval was refused so nothing stale is applied. ' : 'Another meeting was approved or a task was edited. '}
            Re-check to see the proposal against the board as it is now. Your answers and edits are kept, and any change is listed for you.
          </Notice>
        )}
        {diff && (
          <Notice tone="sky" role="status" title={`What changed after your last action (version ${diff.from} → ${diff.to})`}
            actions={<Button size="sm" kind="ghost" onClick={() => setDiff(null)}>Dismiss</Button>}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{diff.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Notice>
        )}
        {derived.orphans.length > 0 && <OrphanNotice orphans={derived.orphans} ctx={ctx} />}
      </div>

      <Section title="Proposed changes" count={planned.length} className="mt-6">
        <ChangesTable rows={[...applying, ...waiting, ...excludedRows, ...(showAll ? other : [])]} cs={cs} applied={applied} onOpen={k => setOpenKey(k)} />
        {other.length > 0 && (
          <Button kind="link" className="mt-2 text-[13px]" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Hide items that do not change the board' : `Show ${plural(other.length, 'item')} that will not change the board`}
          </Button>
        )}
      </Section>

      {derived.openQs.length > 0 && (
        <Section title="Questions to answer" count={derived.openQs.length} className="mt-6">
          <p className="mb-2 text-[13.5px] text-slate">Ordered by how much each blocks: whether the work exists first, then who owns it, then dates.</p>
          <ul className="divide-y divide-rule border-y border-rule">{derived.openQs.map(c => <QuestionRow key={c.id} c={c} ctx={ctx} />)}</ul>
        </Section>
      )}

      {derived.answered.length > 0 && (
        <Section title="Your answers" count={derived.answered.length} className="mt-6">
          <ul className="divide-y divide-rule border-y border-rule text-[13.5px]">
            {derived.answered.map(c => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="text-faint">{Q_LABEL[c.kind] ?? 'Question'}</span>
                <span className="min-w-0 flex-1 text-ink">{answerLabel(c.answer!.choice, c.answer!.value)}<span className="text-faint"> for “{cs.proposal.items.find(i => i.key === c.item_keys[0])?.title}”</span></span>
                {editable && <Button kind="link" size="sm" disabled={busy} onClick={() => ctx.patch({ answers: { [qkey(c)]: null } })}>Change answer</Button>}
              </li>))}
          </ul>
        </Section>
      )}

      {cs.proposal.decisions_review.length > 0 && <Decisions cs={cs} ctx={ctx} />}
      <Checks cs={cs} ctx={ctx} />

      {editable && (
        <div className="sticky bottom-3 z-20 mt-8">
          <div className="shadow-pop flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule-strong bg-panel px-4 py-3">
            <p className="min-w-0 text-[13.5px]">
              {blockedBy ? <span className="text-ink">{blockedBy}</span>
                : <><span className="text-ink">Approving applies {summarize(planned)}, exactly as listed.</span> <span className="text-faint">Version {cs.version}.</span></>}
            </p>
            <div className="flex gap-2">
              <Button kind="ghost" onClick={() => setRejectOpen(true)} disabled={busy}>Reject all</Button>
              <Button kind="primary" icon={<Check size={15} />} onClick={approve} loading={busy} disabled={!!blockedBy}>Approve</Button>
            </div>
          </div>
        </div>
      )}

      {openItem && <ChangeDrawer p={openItem} ctx={ctx} applied={applied} onClose={() => setOpenKey(null)} />}
      <Drawer open={transcript} onClose={() => setTranscript(false)} title="Transcript" sub={meeting.title} width={560}>
        {audioUrl && <audio ref={audio} controls preload="metadata" src={audioUrl} className="mb-3 h-9 w-full" aria-label="Meeting recording" />}
        <Transcript segments={derived.segments} names={derived.names} focus={focus} audio={audio} hasAudio={!!audioUrl} />
      </Drawer>
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject all proposed changes?"
        footer={<><Button onClick={() => setRejectOpen(false)}>Keep reviewing</Button><Button kind="danger" loading={busy} onClick={reject}>Reject all</Button></>}>
        <p className="mb-3 text-slate">Nothing from this meeting will be applied. You can re-run the analysis later to get a new proposal.</p>
        <Field label="Reason (optional)"><textarea className={`${inputCls} h-20 py-2`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></Field>
      </Dialog>
      {derived.people.length > 0 && <datalist id="people">{derived.people.map(x => <option key={x} value={x} />)}</datalist>}
    </div>
  )
}

// ---- table of changes -------------------------------------------------------------------------

function Lines({ changes, side }: { changes: FieldChange[]; side: 'from' | 'to' }) {
  return (
    <ul className="space-y-0.5">
      {changes.map((c, i) => (
        <li key={i} className="text-[13.5px]">
          <span className="text-faint">{c.field}: </span>
          <span className={side === 'to' ? 'font-medium text-ink' : 'text-slate'}>{side === 'from' ? c.from ?? '—' : c.to}</span>
        </li>))}
    </ul>
  )
}

function ChangesTable({ rows, cs, applied, onOpen }: { rows: Planned[]; cs: ChangeSet; applied: Record<string, FieldChange[] | null>; onOpen: (k: string) => void }) {
  if (!rows.length) return <Empty>Nothing in this meeting changes the task board.</Empty>
  const done = cs.state === 'APPLIED'
  const codeFor = (p: Planned) => cs.applied_result.created?.[p.item.key] ?? p.item.existing_task_id
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]">
        <thead className="text-[12.5px] text-faint">
          <tr className="border-b border-rule">
            <th className="py-2 pr-4 font-medium">Task</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Change</th>
            <th className="hidden py-2 pr-4 font-medium md:table-cell">{done ? 'Before' : 'Current'}</th>
            <th className="py-2 pr-4 font-medium">{done ? 'After' : 'Proposed'}</th><th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const code = codeFor(p)
            const ch = done ? (code && applied[code]) || [] : p.changes
            const isNew = !p.item.existing_task_id
            const title = p.task?.title ?? p.item.title
            return (
              <tr key={p.item.key} data-item={p.item.key} className="cursor-pointer border-b border-rule align-top hover:bg-panel-2" onClick={() => onOpen(p.item.key)}>
                <td className="py-2.5 pr-4">
                  <button type="button" className="text-left font-medium text-ink hover:underline" onClick={e => { e.stopPropagation(); onOpen(p.item.key) }}>{title}</button>
                  <div className="text-[12.5px] text-faint">{isNew ? (done && code ? code : 'New task') : p.item.existing_task_id}
                    {/* On phones the Change column is hidden; its words move here. */}
                    {!isNew && <span className="sm:hidden">: {(done && code && applied[code] ? actionFor(ch, isNew) : p.action).toLowerCase()}</span>}</div>
                </td>
                <td className="hidden py-2.5 pr-4 text-slate sm:table-cell">{done && code && applied[code] ? actionFor(ch, isNew) : p.action}</td>
                <td className="hidden py-2.5 pr-4 md:table-cell">{isNew && !(done && ch.some(c => c.from)) ? <span className="text-[13.5px] text-faint">Not on the board</span> : <Lines changes={ch} side="from" />}</td>
                <td className="py-2.5 pr-4">{ch.length ? <Lines changes={ch} side="to" /> : <span className="text-[13.5px] text-faint">—</span>}</td>
                <td className="py-2.5"><Status tone={p.status.tone}>{p.status.label}</Status></td>
              </tr>)
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- questions ------------------------------------------------------------------------------------

function QuestionRow({ c, ctx, inDrawer }: { c: Clarification; ctx: Ctx; inDrawer?: boolean }) {
  const [val, setVal] = useState('')
  const cands = (c.data.candidates as string[] | undefined) ?? []
  const answer = (choice: string, value?: string | null) => ctx.patch({ answers: { [qkey(c)]: { choice, value: value ?? null } } })
  const dis = !ctx.editable || ctx.busy
  const item = ctx.cs.proposal.items.find(i => i.key === c.item_keys[0])
  return (
    <li className="py-3" data-question={c.kind}>
      <div className="text-[12.5px] font-medium text-ask">{Q_LABEL[c.kind] ?? 'Question'}</div>
      <p className="mt-0.5 text-[14.5px] text-ink">{c.question}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {item && !inDrawer && <Button kind="link" size="sm" className="text-[12.5px]" onClick={() => ctx.open(item.key)}>Details of “{item.title}”</Button>}
        {c.segment_ids.map(k => <SegRef key={k} segKey={k} seg={ctx.cs.segments[k]} name={ctx.names[ctx.cs.segments[k]?.speaker_label]} onClick={() => ctx.show(k)} />)}
      </div>
      {ctx.editable && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {c.kind === 'unmapped_speaker' && c.data.speaker_label && (<>
            <input aria-label="Person's name" list="people" className={`${inputCls} max-w-[15rem]`} placeholder={`Who is ${c.data.speaker_label}?`} value={val} onChange={e => setVal(e.target.value)} />
            <Button kind="primary" size="sm" disabled={dis || !val.trim()} onClick={() => ctx.mapSpeaker(String(c.data.speaker_label), val.trim())}>Map speaker</Button>
            <Button size="sm" disabled={dis} onClick={() => answer('unassigned')}>Leave unassigned</Button>
          </>)}
          {['missing_owner', 'group_owner', 'pending_acceptance'].includes(c.kind) && (<>
            {c.kind === 'pending_acceptance' && c.data.candidate && <Button kind="primary" size="sm" disabled={dis} onClick={() => answer('accepted')}>Yes, {String(c.data.candidate)} accepted</Button>}
            <input aria-label="Owner" list="people" className={`${inputCls} max-w-[12rem]`} placeholder="Owner" value={val} onChange={e => setVal(e.target.value)} />
            <Button size="sm" disabled={dis || !val.trim()} onClick={() => answer('set_owner', val.trim())}>Set owner</Button>
            <Button size="sm" kind="ghost" disabled={dis} onClick={() => answer('unassigned')}>Leave unassigned</Button>
          </>)}
          {c.kind === 'ambiguous_deadline' && (<>
            {cands.map(d => <Button key={d} size="sm" disabled={dis} onClick={() => answer('set_due', d)}>{fmtDate(d)}</Button>)}
            <input aria-label="Due date" type="date" className={`${inputCls} max-w-[11rem]`} value={val} onChange={e => setVal(e.target.value)} />
            <Button size="sm" disabled={dis || !val} onClick={() => answer('set_due', val)}>Use this date</Button>
            <Button size="sm" kind="ghost" disabled={dis} onClick={() => answer('no_deadline')}>No deadline</Button>
          </>)}
          {c.kind === 'ambiguous_cancellation_existing' && (<><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('cancel_task')}>Cancel the whole task</Button><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('keep_task')}>Keep the task</Button></>)}
          {c.kind === 'ambiguous_cancellation_new' && (<><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('cancel')}>It is cancelled</Button><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('keep')}>Keep it</Button></>)}
          {['possible_existing_match', 'ambiguous_reference'].includes(c.kind) && (<>
            {cands.filter(x => /^TASK-/.test(x)).map(t => <Button key={t} size="sm" kind="primary" disabled={dis} onClick={() => answer('link', t)}>Same as {t}</Button>)}
            <Button size="sm" disabled={dis} onClick={() => answer('new')}>It is a new task</Button>
          </>)}
          {c.kind === 'unverified_reference' && (<><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('confirm')}>Yes, that task</Button><Button size="sm" disabled={dis} onClick={() => answer('new')}>A new task</Button><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('drop')}>Drop it</Button></>)}
          {c.kind === 'instruction_to_assistant' && (<><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('drop')}>Not a team action</Button><Button size="sm" disabled={dis} onClick={() => answer('keep')}>It is a genuine action</Button></>)}
          {c.kind === 'missing_prerequisite' && <Button size="sm" disabled={dis} onClick={() => answer('drop_dependency')}>Remove this dependency</Button>}
        </div>
      )}
    </li>
  )
}

// ---- answers the server no longer uses -------------------------------------------------------------

function OrphanNotice({ orphans, ctx }: { orphans: Orphan[]; ctx: Ctx }) {
  const n = orphans.length
  return (
    <Notice tone="ask" role="alert" title={`${plural(n, 'earlier answer')} no longer ${n === 1 ? 'applies' : 'apply'}`}>
      <p>When the proposal was re-checked, the question {n === 1 ? 'this answer was' : 'these answers were'} for was no longer asked, so the server is not using {n === 1 ? 'it' : 'them'}. Decide what you want before approving.</p>
      <ul className="mt-2 space-y-3">
        {orphans.map(o => {
          const it = o.item
          const now = !it ? 'That item is no longer proposed.'
            : OWNER_KINDS.includes(o.kind) ? `It is now proposed with owner ${it.owner ?? 'unassigned'}${it.owner ? ` (${it.owner_status === 'named' ? 'named in the meeting' : it.owner_status.replace(/_/g, ' ')})` : ''}.`
            : o.kind === 'ambiguous_deadline' ? `It is now proposed with ${it.deadline.date ? `due date ${fmtDate(it.deadline.date)}` : 'no due date'}.`
            : it.existing_task_id ? `It is now an update to ${it.existing_task_id}.` : 'It is now a new task.'
          const drop = { answers: { [o.key]: null } }
          return (
            <li key={o.key} className="text-ink">
              <div>Your answer “{answerLabel(o.choice, o.value)}” for {it ? `“${it.title}”` : 'an item'} ({(Q_LABEL[o.kind] ?? o.kind).toLowerCase()}) was not applied. {now}</div>
              {ctx.editable && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {it && OWNER_KINDS.includes(o.kind) && o.choice === 'unassigned' && it.owner && (
                    <Button size="sm" kind="primary" disabled={ctx.busy} onClick={() => ctx.patch({ ...drop, items: { [it.key]: { owner: null } } })}>Leave it unassigned</Button>)}
                  {it && OWNER_KINDS.includes(o.kind) && o.choice === 'set_owner' && o.value && o.value !== it.owner && (
                    <Button size="sm" kind="primary" disabled={ctx.busy} onClick={() => ctx.patch({ ...drop, items: { [it.key]: { owner: o.value } } })}>Make {o.value} the owner</Button>)}
                  {it && o.kind === 'ambiguous_deadline' && o.choice === 'set_due' && o.value && o.value !== it.deadline.date && (
                    <Button size="sm" kind="primary" disabled={ctx.busy} onClick={() => ctx.patch({ ...drop, items: { [it.key]: { due_date: o.value } } })}>Use {fmtDate(o.value)}</Button>)}
                  {it && o.kind === 'ambiguous_deadline' && o.choice === 'no_deadline' && it.deadline.date && (
                    <Button size="sm" kind="primary" disabled={ctx.busy} onClick={() => ctx.patch({ ...drop, items: { [it.key]: { due_date: null } } })}>Remove the due date</Button>)}
                  <Button size="sm" disabled={ctx.busy} onClick={() => ctx.patch(drop)}>Keep the current proposal</Button>
                </div>
              )}
            </li>)
        })}
      </ul>
    </Notice>
  )
}

// ---- details drawer -------------------------------------------------------------------------------

function ChangeDrawer({ p, ctx, applied, onClose }: { p: Planned; ctx: Ctx; applied: Record<string, FieldChange[] | null>; onClose: () => void }) {
  const it = p.item
  const { cs } = ctx
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ title: it.title, owner: it.owner ?? '', due: it.deadline.date ?? '', priority: it.priority.value ?? '' })
  const [promote, setPromote] = useState({ owner: it.owner ?? '', due: it.deadline.date ?? '' })
  const done = cs.state === 'APPLIED'
  const code = cs.applied_result.created?.[it.key] ?? it.existing_task_id
  const ch = done ? (code && applied[code]) || [] : p.changes
  const qs = cs.proposal.clarifications.filter(c => c.item_keys.includes(it.key) && !c.deferred)
  const canEdit = ctx.editable && !['tentative', 'cancelled', 'rejected', 'completed', 'no_change'].includes(it.state) && !['drop', 'none', 'suggest'].includes(it.operation)
  const canExclude = ctx.editable && ['create', 'update', 'cancel', 'complete', 'hold'].includes(it.operation)
  const isNew = !it.existing_task_id
  const title = p.task?.title ?? it.title
  async function save() {
    const e: Record<string, unknown> = {}
    if (isNew && form.title.trim() && form.title !== it.title) e.title = form.title.trim()
    if (form.owner.trim() !== (it.owner ?? '')) e.owner = form.owner.trim() || null
    if (form.due !== (it.deadline.date ?? '')) e.due_date = form.due || null
    if (form.priority && form.priority !== it.priority.value) e.priority = form.priority
    if (!Object.keys(e).length || await ctx.patch({ items: { [it.key]: e } })) setEditing(false)
  }
  return (
    <Drawer open onClose={onClose} title={title} sub={isNew ? (done && code ? `${code}, created by this approval` : 'New task') : `${it.existing_task_id}, existing task`}>
      <div className="space-y-6 text-[14px]">
        <div className="flex flex-wrap items-center gap-3"><Status tone={p.status.tone}>{p.status.label}</Status><span className="text-slate">{done && code && applied[code] ? actionFor(ch, isNew) : p.action}</span></div>

        <section>
          <h3 className="mb-1.5 text-[13px] font-semibold text-slate">{done ? 'What approval changed' : p.applies ? 'What approval will change' : p.group === 'waiting' ? 'What approval will change once answered' : 'Effect on the board'}</h3>
          {ch.length ? (
            <table className="w-full text-[13.5px]"><tbody>
              {ch.map((c, i) => (
                <tr key={i} className="border-b border-rule last:border-0">
                  <td className="w-24 py-1.5 pr-3 text-faint">{c.field}</td>
                  <td className="py-1.5 pr-3 text-slate">{c.from ?? (isNew ? 'Not on the board' : '—')}</td>
                  <td className="py-1.5 font-medium text-ink">{c.to}</td>
                </tr>))}
            </tbody></table>
          ) : <p className="text-slate">{done ? 'No field changes were recorded for this item.' : 'Nothing on the board changes for this item.'}</p>}
          {!done && p.notes.length > 0 && <ul className="mt-2 space-y-1">{p.notes.map((n, i) => <li key={i} className="flex gap-1.5 text-[13px] text-slate"><Info size={13} className="mt-[3px] shrink-0 text-faint" />{n}</li>)}</ul>}
        </section>

        {qs.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold text-slate">Questions about this item</h3>
            <ul className="divide-y divide-rule">
              {qs.map(c => c.answer
                ? <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-2 text-[13.5px]"><span className="text-faint">{Q_LABEL[c.kind]}</span><span className="flex-1 text-ink">{answerLabel(c.answer.choice, c.answer.value)}</span>
                  {ctx.editable && <Button kind="link" size="sm" disabled={ctx.busy} onClick={() => ctx.patch({ answers: { [qkey(c)]: null } })}>Change answer</Button>}</li>
                : <QuestionRow key={c.id} c={c} ctx={ctx} inDrawer />)}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-slate">What was said</h3>
          {it.evidence_segment_ids.length ? (
            <div className="space-y-3">{it.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={cs.segments[k]} name={ctx.names[cs.segments[k]?.speaker_label]} onShow={ctx.show} />)}</div>
          ) : <p className="text-slate">No transcript evidence is attached.</p>}
        </section>

        {it.depends_on.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[13px] font-semibold text-slate">Proposed dependencies</h3>
            <ul className="space-y-1">{it.depends_on.map(d => (
              <li key={d.key} className="flex items-center justify-between gap-2"><span>Waits for {d.existing_task_id && <span className="text-faint">{d.existing_task_id} </span>}{d.title}</span>
                {ctx.editable && <Button size="sm" kind="ghost" disabled={ctx.busy} aria-label={`Remove dependency on ${d.title}`} onClick={() => ctx.patch({ items: { [it.key]: { drop_dependencies: [d.key] } } })}>Remove</Button>}</li>))}
            </ul>
          </section>
        )}

        {it.history.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[13px] font-semibold text-slate">How this was worked out</h3>
            <ol className="space-y-1 text-[13px]">
              {it.history.map((h, i) => (
                <li key={i} className="flex gap-2"><span className="tnum w-4 shrink-0 text-faint">{i + 1}</span>
                  <span className="min-w-0 text-slate"><span className="font-medium text-ink">{h.type.toLowerCase().replace(/_/g, ' ')}</span>: {h.summary}{' '}
                    {h.segment_ids.map(k => <button key={k} type="button" className="text-sky hover:underline" onClick={() => ctx.show(k)}>{k} </button>)}</span>
                </li>))}
            </ol>
          </section>
        )}

        {ctx.editable && it.state === 'tentative' && (
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-slate">Make it a task</h3>
            <p className="text-slate">This was only suggested in the meeting. A task needs an owner, and it still goes through approval.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner"><input className={inputCls} list="people" value={promote.owner} onChange={e => setPromote({ ...promote, owner: e.target.value })} /></Field>
              <Field label="Due date (optional)"><input type="date" className={inputCls} value={promote.due} onChange={e => setPromote({ ...promote, due: e.target.value })} /></Field>
            </div>
            <Button kind="primary" disabled={ctx.busy || !promote.owner.trim()} onClick={() => ctx.patch({ items: { [it.key]: { promote: true, owner: promote.owner.trim(), ...(promote.due ? { due_date: promote.due } : {}) } } })}>Add as proposed task</Button>
          </section>
        )}

        {canEdit && (editing ? (
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-slate">Edit before approving</h3>
            {isNew ? <Field label="Title"><input className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
              : <p className="text-[13px] text-slate">The title of an existing task cannot be changed here; approval never renames tasks.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Owner"><input className={inputCls} list="people" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} /></Field>
              <Field label="Due date"><input type="date" className={inputCls} value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} /></Field>
              <Field label="Priority">
                <select className={inputCls} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-2"><Button kind="primary" size="sm" loading={ctx.busy} onClick={save}>Save edits</Button><Button size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
          </section>
        ) : null)}

        {ctx.editable && (canEdit || canExclude) && !editing && (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            {canEdit && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {canExclude && (it.excluded
              ? <Button size="sm" disabled={ctx.busy} onClick={() => ctx.patch({ items: { [it.key]: { excluded: false } } })}>Include again</Button>
              : <Button size="sm" kind="ghost" disabled={ctx.busy} onClick={() => ctx.patch({ items: { [it.key]: { excluded: true } } })}>Exclude from approval</Button>)}
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ---- decisions and checks ---------------------------------------------------------------------------

function Decisions({ cs, ctx }: { cs: ChangeSet; ctx: Ctx }) {
  const [pending, setPending] = useState<Record<number, boolean>>({})
  async function toggle(id: number, include: boolean) {
    setPending(p => ({ ...p, [id]: include }))
    await ctx.patch({ decisions: { [id]: { include } } })
    setPending(p => { const n = { ...p }; delete n[id]; return n })
  }
  return (
    <Section title="Decisions to record" count={cs.proposal.decisions_review.length} className="mt-6">
      <p className="mb-2 text-[13.5px] text-slate">Ticked decisions are recorded as approved with this meeting.</p>
      <ul className="divide-y divide-rule border-y border-rule">{cs.proposal.decisions_review.map(d => (
        <li key={d.id} className="py-2.5">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-1 accent-[var(--accent)]" disabled={!ctx.editable || ctx.busy} checked={pending[d.id] ?? d.include}
              onChange={e => toggle(d.id, e.target.checked)} />
            <span className="text-ink">{d.text}</span>
          </label>
          <div className="ml-6 mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-slate">
            <span>{d.rationale ? `Reason given: ${d.rationale}` : 'No reason was given.'}</span>
            {d.evidence_segment_ids.map(k => <SegRef key={k} segKey={k} seg={cs.segments[k]} name={ctx.names[cs.segments[k]?.speaker_label]} onClick={() => ctx.show(k)} />)}
          </div>
        </li>))}
      </ul>
    </Section>
  )
}

function Checks({ cs, ctx }: { cs: ChangeSet; ctx: Ctx }) {
  const p = cs.proposal
  const unc = p.uncovered_segment_ids ?? []
  if (!p.warnings.length && !p.rejected_events.length && !unc.length) return null
  return (
    <Section title="Checks" className="mt-6">
      <ul className="divide-y divide-rule border-y border-rule text-[13.5px]">
        {p.warnings.map((w, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span className={w.kind === 'possible_prompt_injection' ? 'text-cancel' : 'text-faint'}>{cap(w.kind.replace(/_/g, ' '))}</span>
            <span className="text-slate">{w.detail}</span>
            {w.segment_ids.map(k => <SegRef key={k} segKey={k} seg={cs.segments[k]} onClick={() => ctx.show(k)} />)}
          </li>))}
        {p.rejected_events.map((r, i) => <li key={`r${i}`} className="py-2"><span className="text-cancel">Model output rejected</span> <span className="text-slate">{r.reason}</span></li>)}
        {unc.length > 0 && (
          <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"><span className="text-faint">Nothing extracted</span><span className="text-slate">These lines produced no commitment. Check that nothing was missed:</span>
            {unc.map(k => <SegRef key={k} segKey={k} seg={cs.segments[k]} onClick={() => ctx.show(k)} />)}</li>
        )}
      </ul>
      <p className="mt-1 text-[12.5px] text-faint">Last updated {fmtDateTime(cs.updated_at)}.</p>
    </Section>
  )
}

