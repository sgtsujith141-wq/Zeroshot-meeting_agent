import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtDateTime } from '../lib/api'
import type { ChangeSet, Clarification, MeetingDetail, ProposalItem } from '../types'
import { Button, Chip, Empty, ErrorBox, Loading, PageHeader, Panel, Quote, StateChip, inputCls, stateLabel, useLoad } from '../components/ui'

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number; updated_at: string }

function ChangeSetList() {
  const { data, error, loading } = useLoad(() => api.get<CsRow[]>('/api/changesets'))
  const order = ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW', 'FAILED', 'APPLIED', 'REJECTED']
  return (
    <>
      <PageHeader title="Review changes" sub="Each analysed meeting produces one set of proposed changes. Answer its questions, adjust anything, then approve." />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No proposed changes yet. Analyse a meeting first.</Empty> : (
        <ul className="divide-y divide-rule rounded-[10px] border border-rule bg-panel">
          {[...data].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).map(c => (
            <li key={c.id}>
              <Link to={`/review/${c.meeting_id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                <span className="font-medium">{c.meeting_title}</span>
                <span className="flex items-center gap-3 text-[13.5px] text-slate">
                  {c.items} item(s){c.open_questions ? <Chip tone="ask">{c.open_questions} question(s) open</Chip> : null}
                  <StateChip state={c.state} />
                </span>
              </Link>
            </li>))}
        </ul>
      )}
    </>
  )
}

const OP_STYLE: Record<string, { bar: string; label: string }> = {
  create: { bar: 'bg-create', label: 'New task' }, update: { bar: 'bg-update', label: 'Change to existing task' },
  cancel: { bar: 'bg-cancel', label: 'Cancel existing task' }, complete: { bar: 'bg-create', label: 'Mark existing task done' },
  hold: { bar: 'bg-ask', label: 'On hold' }, suggest: { bar: 'bg-rule', label: 'Suggestion' }, drop: { bar: 'bg-rule', label: 'Dropped in meeting' },
  none: { bar: 'bg-rule', label: 'No change' }, create_completed: { bar: 'bg-create', label: 'New task, already done' },
}

function Delta({ label, before, after }: { label: string; before?: string | null; after?: string | null }) {
  const changed = before !== undefined && (before ?? '') !== (after ?? '')
  return (
    <div className="flex flex-wrap gap-x-2 text-[14px]">
      <span className="w-20 shrink-0 text-slate">{label}</span>
      {changed ? <><s className="text-slate decoration-cancel/60">{before || 'none'}</s><span className="text-slate">to</span><strong className="font-semibold text-update">{after || 'none'}</strong></>
        : <span>{after || <span className="text-slate">none</span>}</span>}
    </div>
  )
}

function ItemCard({ item, cs, names, editable, onPatch }: { item: ProposalItem; cs: ChangeSet; names: Record<string, string | null>; editable: boolean; onPatch: (p: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ title: item.title, owner: item.owner ?? '', due_date: item.deadline.date ?? '', priority: item.priority.value ?? '' })
  const style = OP_STYLE[item.operation] ?? OP_STYLE.none
  const b = item.before
  const dl = item.deadline
  async function save() {
    const e: Record<string, unknown> = {}
    if (form.title !== item.title) e.title = form.title
    if (form.owner !== (item.owner ?? '')) e.owner = form.owner || null
    if (form.due_date !== (dl.date ?? '')) e.due_date = form.due_date || null
    if (form.priority && form.priority !== item.priority.value) e.priority = form.priority
    if (Object.keys(e).length) await onPatch({ items: { [item.key]: e } })
    setEditing(false)
  }
  return (
    <article className="relative overflow-hidden rounded-[10px] border border-rule bg-panel">
      <div className={`absolute inset-y-0 left-0 w-1.5 ${style.bar}`} aria-hidden />
      <div className="grid gap-4 p-4 pl-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium text-slate">{style.label}{item.existing_task_id && <> {item.existing_task_id}</>}</span>
            <StateChip state={item.excluded ? 'excluded' : item.state} />
          </div>
          {editing ? (
            <div className="space-y-2">
              <input aria-label="Title" className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <input aria-label="Owner" className={inputCls} list="people" placeholder="Owner" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} />
                <input aria-label="Due date" type="date" className={inputCls} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                <select aria-label="Priority" className={inputCls} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="">Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="flex gap-2"><Button kind="primary" onClick={save}>Save edits</Button><Button onClick={() => setEditing(false)}>Cancel</Button></div>
            </div>
          ) : (
            <>
              <h3 className="text-[17px] font-semibold leading-snug">{b && b.title !== item.title ? <><s className="font-normal text-slate">{b.title}</s> {item.title}</> : item.title}</h3>
              <div className="mt-2 space-y-0.5">
                <Delta label="Owner" before={b ? b.owner : undefined} after={item.owner ?? (item.owner_candidate ? `asked: ${item.owner_candidate}` : null)} />
                <Delta label="Due" before={b ? (b.due_date ? fmtDate(b.due_date) : null) : undefined} after={dl.date ? fmtDate(dl.date) : null} />
                {dl.raw && <div className="pl-[5.5rem] text-[12.5px] text-slate">Said: “{dl.raw}” ({dl.kind}{dl.ambiguous ? ', ambiguous' : ''}){dl.note ? `. ${dl.note}` : ''}</div>}
                <Delta label="Priority" after={item.priority.value ? `${item.priority.value} (${item.priority.basis})` : 'not stated'} />
                {item.depends_on.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 text-[14px]">
                    <span className="w-20 shrink-0 text-slate">Waits for</span>
                    {item.depends_on.map(d => (
                      <span key={d.key} className="inline-flex items-center gap-1">
                        {`${d.existing_task_id ?? ''} ${d.title}`.trim()}
                        {editable && <button className="text-[12.5px] text-cancel hover:underline" aria-label={`Remove dependency on ${d.title}`}
                          onClick={() => onPatch({ items: { [item.key]: { drop_dependencies: [d.key] } } })}>remove</button>}
                      </span>))}
                  </div>
                )}
                {item.blocked_reason && <Delta label="Blocked" after={item.blocked_reason} />}
                {item.owner_status === 'self_mapped' && <div className="pl-[5.5rem] text-[12.5px] text-slate">Owner inferred from the speaker’s own “I will…”.</div>}
              </div>
              {item.plan && (item.plan.calendar_event || item.plan.in_app_reminder_at) && item.state === 'proposed' && (
                <p className="mt-2 text-[13px] text-slate">On approval: {item.plan.calendar_event && 'calendar entry on the due date'}{item.plan.in_app_reminder_at && `, in-app reminder ${fmtDateTime(item.plan.in_app_reminder_at)}`}.</p>
              )}
            </>
          )}
          {item.history.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13.5px] font-medium text-update">How this was worked out ({item.history.length} steps)</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13.5px]">
                {item.history.map((h, i) => <li key={i}><span className="font-medium">{h.type.toLowerCase().replace(/_/g, ' ')}</span>: {h.summary} <span className="text-slate">({h.segment_ids.join(', ')})</span></li>)}
              </ol>
            </details>
          )}
          {editable && !editing && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.state !== 'tentative' && !['drop', 'none'].includes(item.operation) && <Button onClick={() => setEditing(true)}>Edit</Button>}
              {item.state === 'tentative' && <Button onClick={() => { const owner = prompt('Owner for this task?'); if (owner) onPatch({ items: { [item.key]: { promote: true, owner } } }) }}>Make it a task</Button>}
              {['create', 'update', 'cancel', 'complete', 'hold'].includes(item.operation) && (
                <Button kind={item.excluded ? 'secondary' : 'danger'} onClick={() => onPatch({ items: { [item.key]: { excluded: !item.excluded } } })}>{item.excluded ? 'Include again' : 'Exclude from approval'}</Button>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2.5">
          <div className="text-[13px] font-medium text-slate">What was said</div>
          {item.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={cs.segments[k]} speakerName={names[cs.segments[k]?.speaker_label]} meetingId={cs.meeting_id} />)}
        </div>
      </div>
    </article>
  )
}

function QuestionCard({ c, cs, names, people, editable, onAnswer, onMapSpeaker }: {
  c: Clarification; cs: ChangeSet; names: Record<string, string | null>; people: string[]; editable: boolean
  onAnswer: (c: Clarification, choice: string | null, value?: string | null) => Promise<void>; onMapSpeaker: (label: string, name: string) => Promise<void>
}) {
  const [val, setVal] = useState('')
  const cands = (c.data.candidates as string[] | undefined) ?? []
  const ownerKinds = ['missing_owner', 'group_owner', 'pending_acceptance', 'unmapped_speaker']
  return (
    <li className="rounded-[10px] border border-ask/40 bg-panel p-4">
      <p className="font-medium">{c.question}</p>
      <div className="mt-2 space-y-2">{c.segment_ids.map(k => <Quote key={k} segKey={k} seg={cs.segments[k]} speakerName={names[cs.segments[k]?.speaker_label]} meetingId={cs.meeting_id} />)}</div>
      {c.answer ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-create">Answered: {c.answer.choice.replace(/_/g, ' ')}{c.answer.value ? ` (${c.answer.value})` : ''}
          {editable && <Button kind="quiet" onClick={() => onAnswer(c, null)}>Change answer</Button>}</p>
      ) : editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {c.kind === 'unmapped_speaker' && c.data.speaker_label && (
            <>
              <input aria-label="Person's name" list="people" className={`${inputCls} max-w-[14rem]`} placeholder={`Who is ${c.data.speaker_label}?`} value={val} onChange={e => setVal(e.target.value)} />
              <Button kind="primary" disabled={!val.trim()} onClick={() => onMapSpeaker(String(c.data.speaker_label), val.trim())}>Map speaker</Button>
              <Button onClick={() => onAnswer(c, 'unassigned')}>Leave unassigned</Button>
            </>
          )}
          {ownerKinds.includes(c.kind) && c.kind !== 'unmapped_speaker' && (
            <>
              {c.kind === 'pending_acceptance' && c.data.candidate && <Button kind="primary" onClick={() => onAnswer(c, 'accepted')}>Yes, {String(c.data.candidate)} accepted</Button>}
              <input aria-label="Owner" list="people" className={`${inputCls} max-w-[12rem]`} placeholder="Owner" value={val} onChange={e => setVal(e.target.value)} />
              <Button disabled={!val.trim()} onClick={() => onAnswer(c, 'set_owner', val.trim())}>Set owner</Button>
              <Button onClick={() => onAnswer(c, 'unassigned')}>Leave unassigned</Button>
            </>
          )}
          {c.kind === 'ambiguous_deadline' && (
            <>
              {cands.map(d => <Button key={d} onClick={() => onAnswer(c, 'set_due', d)}>{fmtDate(d)}</Button>)}
              <input aria-label="Due date" type="date" className={`${inputCls} max-w-[11rem]`} value={val} onChange={e => setVal(e.target.value)} />
              <Button disabled={!val} onClick={() => onAnswer(c, 'set_due', val)}>Use this date</Button>
              <Button onClick={() => onAnswer(c, 'no_deadline')}>No deadline</Button>
            </>
          )}
          {c.kind === 'ambiguous_cancellation_existing' && (<><Button kind="danger" onClick={() => onAnswer(c, 'cancel_task')}>Cancel the whole task</Button><Button kind="primary" onClick={() => onAnswer(c, 'keep_task')}>Keep the task</Button></>)}
          {c.kind === 'ambiguous_cancellation_new' && (<><Button kind="danger" onClick={() => onAnswer(c, 'cancel')}>It is cancelled</Button><Button kind="primary" onClick={() => onAnswer(c, 'keep')}>Keep it</Button></>)}
          {['possible_existing_match', 'ambiguous_reference'].includes(c.kind) && (
            <>{cands.filter(x => /^TASK-/.test(x)).map(t => <Button key={t} kind="primary" onClick={() => onAnswer(c, 'link', t)}>Same as {t}</Button>)}<Button onClick={() => onAnswer(c, 'new')}>It is a new task</Button></>
          )}
          {c.kind === 'unverified_reference' && (<><Button kind="primary" onClick={() => onAnswer(c, 'confirm')}>Yes, that task</Button><Button onClick={() => onAnswer(c, 'new')}>A new task</Button><Button kind="danger" onClick={() => onAnswer(c, 'drop')}>Drop it</Button></>)}
          {c.kind === 'instruction_to_assistant' && (<><Button kind="primary" onClick={() => onAnswer(c, 'drop')}>Not a team action</Button><Button onClick={() => onAnswer(c, 'keep')}>It is a genuine action</Button></>)}
          {c.kind === 'missing_prerequisite' && <Button onClick={() => onAnswer(c, 'drop_dependency')}>Remove this dependency</Button>}
        </div>
      )}
      {people.length > 0 && <datalist id="people">{people.map(p => <option key={p} value={p} />)}</datalist>}
    </li>
  )
}

export default function ReviewPage() {
  const { meetingId } = useParams()
  if (!meetingId) return <ChangeSetList />
  return <Review mid={Number(meetingId)} />
}

function Review({ mid }: { mid: number }) {
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [cs, meeting] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`)])
    return { cs, meeting }
  }, [mid])
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  if (loading && !data) return <Loading />
  if (!data) return <ErrorBox error={error} onRetry={reload} />
  const { cs, meeting } = data
  const names = Object.fromEntries(meeting.participants.map(p => [p.speaker_label, p.display_name]))
  const people = [...new Set(meeting.participants.map(p => p.display_name).filter(Boolean) as string[])]
  const editable = ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW', 'DRAFT'].includes(cs.state)
  const p = cs.proposal
  const openQs = p.clarifications.filter(c => !c.deferred && !c.answer).sort((a, b) => a.rank - b.rank)
  const answeredQs = p.clarifications.filter(c => !c.deferred && c.answer)
  const actionable = p.items.filter(i => i.state === 'proposed' && !i.excluded && ['create', 'update', 'cancel', 'complete', 'create_completed'].includes(i.operation))
  const groups: [string, ProposalItem[]][] = [
    ['Changes to existing tasks', p.items.filter(i => i.existing_task_id && !['tentative', 'cancelled', 'rejected'].includes(i.state))],
    ['New tasks', p.items.filter(i => !i.existing_task_id && ['proposed', 'needs_clarification', 'held', 'excluded'].includes(i.state))],
    ['Not becoming tasks', p.items.filter(i => ['tentative', 'cancelled', 'rejected', 'completed'].includes(i.state) && !i.existing_task_id)],
  ]

  async function act(fn: () => Promise<ChangeSet | void>) {
    setBusy(true); setActionErr(null)
    try { const r = await fn(); if (r) setData({ cs: r, meeting }); else await reload() } catch (e) { setActionErr(e instanceof ApiError ? e.message : String(e)) } finally { setBusy(false) }
  }
  const patch = (body: unknown) => act(() => api.patch<ChangeSet>(`/api/changesets/${cs.id}`, body))
  const answer = (c: Clarification, choice: string | null, value?: string | null) =>
    patch({ answers: { [`${c.item_keys[0]}|${c.kind}`]: choice ? { choice, value: value ?? null } : null } })
  const mapSpeaker = (label: string, name: string) => act(async () => {
    await api.put(`/api/meetings/${mid}/participants/${encodeURIComponent(label)}`, { display_name: name, confirmed_identity: true })
    const [cs2, m2] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`)])
    setData({ cs: cs2, meeting: m2 })
  })
  const approve = () => act(async () => {
    const r = await api.post<{ change_set: ChangeSet; result: Record<string, unknown> }>(`/api/changesets/${cs.id}/approve`, { proposal_hash: cs.proposal_hash })
    setResult(r.result); return r.change_set
  })
  const reject = () => { const reason = prompt('Reason for rejecting these proposed changes (optional)'); if (reason !== null) act(() => api.post<ChangeSet>(`/api/changesets/${cs.id}/reject`, { reason })) }

  const applied = cs.applied_result
  return (
    <div className="pb-28">
      <PageHeader title={`Review: ${cs.meeting_title}`} sub={<>Proposed from the meeting on {fmtDate(meeting.scheduled_at)}. Nothing on this page changes the task board until you approve it.</>}>
        <Link to={`/meetings/${mid}`} className="rounded-md border border-rule bg-panel px-3 py-1.5 text-[14px] font-medium">Open meeting</Link>
      </PageHeader>
      <ErrorBox error={actionErr || error} />
      <div className="mb-6 flex flex-wrap items-center gap-3"><StateChip state={cs.state} /><span className="text-[13px] text-slate">Version {cs.version}, compared against {cs.ledger_snapshot?.length ?? 0} approved task(s) on the board.</span></div>

      {cs.state === 'APPLIED' && (
        <Panel title="Approved and applied" className="mb-6">
          <p>Created {Object.values(applied.created ?? {}).join(', ') || 'no new tasks'}{applied.updated?.length ? `; updated ${applied.updated.join(', ')}` : ''}{applied.cancelled?.length ? `; cancelled ${applied.cancelled.join(', ')}` : ''}{applied.completed?.length ? `; marked done ${applied.completed.join(', ')}` : ''}.</p>
          {result && (result as { idempotent_replay?: boolean }).idempotent_replay && <p className="text-slate">This approval had already been applied; nothing was duplicated.</p>}
          <Link className="mt-2 inline-block font-medium text-update underline" to="/tasks">Open the task board</Link>
        </Panel>
      )}
      {cs.state === 'FAILED' && <ErrorBox error={`Applying failed and nothing was written: ${cs.error}`} />}

      {openQs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-[18px] font-semibold">{openQs.length === 1 ? 'One question to answer before approval' : `${openQs.length} questions to answer before approval`}</h2>
          <p className="mb-3 text-slate">Asked in order of how much they block: whether the work exists first, then ownership, then dates.</p>
          <ul className="space-y-3">{openQs.map(c => <QuestionCard key={c.id} c={c} cs={cs} names={names} people={people} editable={editable && !busy} onAnswer={answer} onMapSpeaker={mapSpeaker} />)}</ul>
        </section>
      )}

      {groups.map(([title, items]) => items.length > 0 && (
        <section key={title} className="mb-8">
          <h2 className="mb-3 text-[18px] font-semibold">{title} <span className="font-normal text-slate">({items.length})</span></h2>
          <div className="space-y-3">{items.map(i => <ItemCard key={i.key} item={i} cs={cs} names={names} editable={editable && !busy} onPatch={patch} />)}</div>
        </section>
      ))}

      {p.decisions_review.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[18px] font-semibold">Decisions to record</h2>
          <ul className="space-y-3">{p.decisions_review.map(d => (
            <li key={d.id} className="rounded-[10px] border border-rule bg-panel p-4">
              <label className="flex items-start gap-2 font-medium"><input type="checkbox" className="mt-1" disabled={!editable} checked={d.include}
                onChange={e => patch({ decisions: { [d.id]: { include: e.target.checked } } })} />{d.text}</label>
              <p className="pl-6 text-[14px] text-slate">{d.rationale ? `Reason given: ${d.rationale}` : 'No reason was extracted; check the quote below.'}</p>
              <div className="mt-2 space-y-2 pl-6">{d.evidence_segment_ids.map(k => <Quote key={k} segKey={k} seg={cs.segments[k]} speakerName={names[cs.segments[k]?.speaker_label]} meetingId={mid} />)}</div>
            </li>))}
          </ul>
        </section>
      )}

      {(p.warnings.length > 0 || p.rejected_events.length > 0 || (p as { uncovered_segment_ids?: string[] }).uncovered_segment_ids?.length) && (
        <Panel title="Checks" className="mb-8">
          <ul className="space-y-2 text-[14px]">
            {p.warnings.map((w, i) => <li key={i}><Chip tone={w.kind === 'possible_prompt_injection' ? 'cancel' : 'neutral'}>{w.kind.replace(/_/g, ' ')}</Chip> <span className="ml-1">{w.detail}</span> <span className="text-slate">({w.segment_ids.join(', ')})</span></li>)}
            {p.rejected_events.map((r, i) => <li key={`r${i}`}><Chip tone="cancel">rejected model output</Chip> <span className="ml-1">{r.reason}</span></li>)}
            {((p as { uncovered_segment_ids?: string[] }).uncovered_segment_ids ?? []).length > 0 && (
              <li><Chip tone="ask">nothing extracted</Chip> <span className="ml-1">These lines produced no commitment. Check that nothing was missed: </span>
                {((p as { uncovered_segment_ids?: string[] }).uncovered_segment_ids ?? []).map(k => <Link key={k} to={`/meetings/${mid}#${k}`} className="ml-1 text-update hover:underline">{k}</Link>)}</li>
            )}
          </ul>
        </Panel>
      )}
      {answeredQs.length > 0 && <p className="mb-8 text-[13.5px] text-slate">{answeredQs.length} question(s) already answered; their answers are shown on the items above.</p>}

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-panel/95 px-4 py-3 backdrop-blur md:left-[232px]">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3">
            <p className="text-[14px]">{cs.state === 'NEEDS_CLARIFICATION' ? <span className="text-ask">Answer the open questions, or exclude those items, to enable approval.</span>
              : <>Approving applies {actionable.length} change(s) exactly as shown (version {cs.version}, {cs.proposal_hash.slice(0, 8)}).</>}</p>
            <div className="flex gap-2">
              <Button kind="danger" onClick={reject} disabled={busy}>Reject all</Button>
              <Button kind="primary" onClick={approve} disabled={busy || cs.state !== 'READY_FOR_REVIEW'}>{busy ? 'Working…' : `Approve ${actionable.length} change(s)`}</Button>
            </div>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{stateLabel(cs.state)}</p>
    </div>
  )
}
