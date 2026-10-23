import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowRight, Ban, CalendarClock, Check, CheckCircle2, ChevronRight, CircleDashed, ClipboardCheck, FileAudio,
  FileText, HelpCircle, Lightbulb, Link2, MessageSquareQuote, MinusCircle, PauseCircle, Pencil, Plus, ShieldAlert,
  RefreshCw, Sparkles, Undo2, UserRound, Users, X,
} from 'lucide-react'
import { api, ApiError, fmtDate, fmtDateTime } from '../lib/api'
import type { ChangeSet, Clarification, MeetingDetail, ProposalItem, Task } from '../types'
import {
  Avatar, Button, Chip, Dialog, Drawer, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Panel, SegmentChip,
  StateChip, errText, inputCls, stateLabel, useLoad, useToast, type Tone,
} from '../components/ui'
import Transcript, { type Focus } from '../components/Transcript'

// ---------------------------------------------------------------------------------------------
// List of change sets
// ---------------------------------------------------------------------------------------------

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number; updated_at: string }

function ChangeSetList() {
  const { data, error, loading, reload } = useLoad(() => api.get<CsRow[]>('/api/changesets'))
  const groups: [string, string[]][] = [
    ['Needs your decision', ['NEEDS_CLARIFICATION']], ['Ready to approve', ['READY_FOR_REVIEW']],
    ['Approved, rejected or failed', ['APPLIED', 'REJECTED', 'FAILED']],
  ]
  return (
    <>
      <PageHeader title="Review changes" sub="Each analysed meeting proposes changes to the task board. Answer the open questions, adjust anything, then approve." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading rows={3} /> : !data?.length ? (
        <Empty icon={<ClipboardCheck size={22} />} action={<Link to="/meetings/new" className="text-[14px] font-medium text-sky hover:underline">Add a meeting</Link>}>
          No proposed changes yet. They appear here after a meeting has been analysed.
        </Empty>
      ) : (
        <div className="space-y-7">
          {groups.map(([title, states]) => {
            const rows = data.filter(c => states.includes(c.state))
            if (!rows.length) return null
            return (
              <section key={title}>
                <h2 className="mb-2 text-[13.5px] font-medium text-slate">{title} <span className="tnum text-faint">{rows.length}</span></h2>
                <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-panel">
                  {rows.map(c => (
                    <li key={c.id}>
                      <Link to={`/review/${c.meeting_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-panel-2">
                        <span className="min-w-0 flex-1 font-medium text-ink">{c.meeting_title}</span>
                        <span className="text-[13px] text-faint">{c.items} item{c.items === 1 ? '' : 's'}</span>
                        {c.open_questions > 0 && <Chip tone="ask" icon={<HelpCircle size={12} />}>{c.open_questions} open question{c.open_questions === 1 ? '' : 's'}</Chip>}
                        <StateChip state={c.state} />
                        <ChevronRight size={16} className="text-faint" />
                      </Link>
                    </li>))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Change classification (presentation only; derived from the server's proposal)
// ---------------------------------------------------------------------------------------------

type Kind = 'create' | 'owner' | 'due' | 'deps' | 'cancel' | 'complete' | 'reported' | 'hold' | 'suggest' | 'drop' | 'none' | 'blocked'
const KIND: Record<Kind, { label: string; tone: Tone; icon: ReactNode; bar: string }> = {
  create: { label: 'New task', tone: 'create', icon: <Plus size={13} />, bar: 'bg-create' },
  owner: { label: 'Reassigned', tone: 'violet', icon: <UserRound size={13} />, bar: 'bg-violet' },
  due: { label: 'Deadline moved', tone: 'update', icon: <CalendarClock size={13} />, bar: 'bg-sky' },
  deps: { label: 'Dependency changed', tone: 'neutral', icon: <Link2 size={13} />, bar: 'bg-faint' },
  blocked: { label: 'Marked blocked', tone: 'cancel', icon: <MinusCircle size={13} />, bar: 'bg-cancel' },
  cancel: { label: 'Cancel task', tone: 'cancel', icon: <Ban size={13} />, bar: 'bg-cancel' },
  complete: { label: 'Mark done', tone: 'done', icon: <CheckCircle2 size={13} />, bar: 'bg-done' },
  reported: { label: 'Reported done, not on the board', tone: 'neutral', icon: <CheckCircle2 size={13} />, bar: 'bg-rule-strong' },
  hold: { label: 'On hold', tone: 'ask', icon: <PauseCircle size={13} />, bar: 'bg-ask' },
  suggest: { label: 'Suggestion only', tone: 'neutral', icon: <Lightbulb size={13} />, bar: 'bg-rule-strong' },
  drop: { label: 'Dropped in meeting', tone: 'neutral', icon: <MinusCircle size={13} />, bar: 'bg-rule-strong' },
  none: { label: 'Discussed, no change', tone: 'neutral', icon: <CircleDashed size={13} />, bar: 'bg-rule-strong' },
}

function kindsOf(it: ProposalItem): Kind[] {
  if (it.operation === 'create') return ['create']
  if (it.operation === 'cancel') return ['cancel']
  if (it.operation === 'complete' && it.existing_task_id) return ['complete']
  if (it.operation === 'create_completed' || it.state === 'completed') return ['reported']
  if (it.operation === 'hold') return ['hold']
  if (it.operation === 'suggest') return ['suggest']
  if (it.operation === 'drop') return ['drop']
  if (it.operation === 'update' && it.before) {
    const k: Kind[] = []
    if ((it.owner ?? '') !== (it.before.owner ?? '')) k.push('owner')
    if ((it.deadline.date ?? '') !== (it.before.due_date ?? '')) k.push('due')
    const deps = it.depends_on.map(d => d.existing_task_id ?? d.key).sort().join()
    if (deps !== [...(it.before.depends_on ?? [])].sort().join()) k.push('deps')
    if (it.blocked_reason) k.push('blocked')
    return k.length ? k : ['none']
  }
  return ['none']
}

const Q_KIND: Record<string, { label: string; icon: ReactNode }> = {
  unmapped_speaker: { label: 'Who is this speaker?', icon: <Users size={15} /> },
  missing_owner: { label: 'Who owns this?', icon: <UserRound size={15} /> },
  group_owner: { label: 'Which single person?', icon: <UserRound size={15} /> },
  pending_acceptance: { label: 'Did they accept?', icon: <UserRound size={15} /> },
  ambiguous_deadline: { label: 'Which date?', icon: <CalendarClock size={15} /> },
  ambiguous_cancellation_existing: { label: 'Cancel the task or only a plan?', icon: <Ban size={15} /> },
  ambiguous_cancellation_new: { label: 'Is it cancelled?', icon: <Ban size={15} /> },
  possible_existing_match: { label: 'Same task or a new one?', icon: <Link2 size={15} /> },
  ambiguous_reference: { label: 'Which task is meant?', icon: <Link2 size={15} /> },
  unverified_reference: { label: 'Is this the linked task?', icon: <Link2 size={15} /> },
  instruction_to_assistant: { label: 'Instruction addressed to the assistant', icon: <ShieldAlert size={15} /> },
  missing_prerequisite: { label: 'Missing prerequisite', icon: <Link2 size={15} /> },
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

interface Ctx {
  cs: ChangeSet; names: Record<string, string | null>; people: string[]; editable: boolean; busy: boolean
  applied: (it: ProposalItem) => string | null
  focus: (k: string) => void; hover: (keys: string[] | null) => void
  patch: (body: unknown) => Promise<void>
}

function FieldRow({ label, before, after, kind, note, changed, empty = 'None' }: {
  label: string; before?: ReactNode; after: ReactNode; kind?: Kind; note?: ReactNode; changed?: boolean; empty?: string
}) {
  const tone = kind ? KIND[kind].tone : undefined
  const accent = tone === 'violet' ? 'text-violet' : tone === 'update' ? 'text-sky' : 'text-ink'
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
      <dt className="text-[12.5px] text-faint">{label}</dt>
      <dd className="min-w-0 text-[14px]">
        {changed ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate line-through decoration-faint">{before ?? empty}</span>
            <ArrowRight size={13} className="text-faint" />
            <span className={`font-semibold ${accent}`}>{after ?? empty}</span>
            {kind && <Chip tone={KIND[kind].tone} icon={KIND[kind].icon}>{KIND[kind].label}</Chip>}
          </span>
        ) : <span className={after ? 'text-ink' : 'text-faint'}>{after ?? empty}</span>}
        {note && <div className="mt-0.5 text-[12.5px] text-faint">{note}</div>}
      </dd>
    </div>
  )
}

function ItemCard({ item, ctx, onPromote }: { item: ProposalItem; ctx: Ctx; onPromote: (it: ProposalItem) => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ title: item.title, owner: item.owner ?? '', due_date: item.deadline.date ?? '', priority: item.priority.value ?? '' })
  const kinds = kindsOf(item)
  const main = KIND[item.excluded ? 'none' : kinds[0]]
  const b = item.before
  const dl = item.deadline
  const canAct = ctx.editable && !ctx.busy
  async function save() {
    const e: Record<string, unknown> = {}
    if (form.title.trim() && form.title !== item.title) e.title = form.title.trim()
    if (form.owner !== (item.owner ?? '')) e.owner = form.owner.trim() || null
    if (form.due_date !== (dl.date ?? '')) e.due_date = form.due_date || null
    if (form.priority && form.priority !== item.priority.value) e.priority = form.priority
    if (Object.keys(e).length) await ctx.patch({ items: { [item.key]: e } })
    setEditing(false)
  }
  const ownerAfter = item.owner ?? (item.owner_candidate ? `asked: ${item.owner_candidate}` : null)
  const lastSeg = item.evidence_segment_ids[item.evidence_segment_ids.length - 1]
  return (
    <article onMouseEnter={() => ctx.hover(item.evidence_segment_ids)} onMouseLeave={() => ctx.hover(null)}
      className={`relative overflow-hidden rounded-xl border bg-panel shadow-soft transition-colors ${item.excluded ? 'border-rule opacity-60' : 'border-rule hover:border-rule-strong'}`}>
      <div className={`absolute inset-y-0 left-0 w-[3px] ${main.bar}`} aria-hidden />
      <div className="px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {item.operation === 'update'
            ? <Chip tone="neutral" icon={<Pencil size={12} />}>Change to existing task</Chip>
            : kinds.map(k => <Chip key={k} tone={KIND[k].tone} icon={KIND[k].icon}>{KIND[k].label}</Chip>)}
          {item.existing_task_id && <span className="tnum text-[12.5px] font-medium text-slate">{item.existing_task_id}</span>}
          <span className="ml-auto flex items-center gap-2">
            {ctx.applied(item) && <Chip tone="done" icon={<CheckCircle2 size={12} />}>{ctx.applied(item)}</Chip>}
            {!ctx.applied(item) && !['no_change', 'completed'].includes(item.state) && <StateChip state={item.excluded ? 'excluded' : item.state} />}
          </span>
        </div>

        {editing ? (
          <div className="space-y-3">
            <Field label="Title"><input className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Owner"><input className={inputCls} list="people" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} /></Field>
              <Field label="Due date"><input type="date" className={inputCls} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></Field>
              <Field label="Priority">
                <select className={inputCls} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-2"><Button kind="primary" size="sm" onClick={save} loading={ctx.busy}>Save edits</Button><Button size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
          </div>
        ) : (
          <>
            <h3 className="text-[16.5px] font-semibold leading-snug text-ink">
              {b && b.title !== item.title ? <><span className="font-normal text-slate line-through decoration-faint">{b.title}</span> {item.title}</> : item.title}
            </h3>
            <dl className="mt-2 divide-y divide-rule">
              <FieldRow label="Owner" empty="Unassigned" changed={kinds.includes('owner')} kind="owner" before={b?.owner}
                after={ownerAfter ? <span className="inline-flex items-center gap-1.5"><Avatar name={item.owner} size={18} />{ownerAfter}</span> : null}
                note={item.owner_status === 'self_mapped' ? 'Inferred from the speaker’s own “I will…”.' : item.owner_note ?? undefined} />
              <FieldRow label="Due" empty="No date" changed={kinds.includes('due')} kind="due" before={b?.due_date ? fmtDate(b.due_date) : null}
                after={dl.date ? fmtDate(dl.date) : null}
                note={dl.raw && dl.raw !== dl.date ? <>Said “{dl.raw}”, {String(dl.kind ?? '').replace(/_/g, ' ')}{dl.ambiguous ? ', ambiguous' : ''}{dl.note ? `. ${dl.note}` : ''}</> : undefined} />
              <FieldRow label="Priority" empty="Not stated" after={item.priority.value ? <span className="capitalize">{item.priority.value}</span> : null}
                note={item.priority.value ? item.priority.basis : undefined} />
              {(item.depends_on.length > 0 || kinds.includes('deps')) && (
                <FieldRow label="Waits for" after={item.depends_on.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {item.depends_on.map(d => (
                      <span key={d.key} className="inline-flex items-center gap-1 rounded-md border border-rule bg-panel-2 px-1.5 py-0.5 text-[13px]">
                        <Link2 size={12} className="text-faint" />{d.existing_task_id && <span className="text-faint">{d.existing_task_id}</span>}{d.title}
                        {canAct && <button className="ml-0.5 text-faint hover:text-cancel" aria-label={`Remove dependency on ${d.title}`}
                          onClick={() => ctx.patch({ items: { [item.key]: { drop_dependencies: [d.key] } } })}><X size={12} /></button>}
                      </span>))}
                  </span>) : null} />
              )}
              {item.blocked_reason && <FieldRow label="Blocked" after={item.blocked_reason} />}
            </dl>
          </>
        )}

        {item.evidence_segment_ids.length > 0 && (
          <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <MessageSquareQuote size={14} className="text-faint" />
              {item.evidence_segment_ids.map(k => (
                <SegmentChip key={k} segKey={k} seg={ctx.cs.segments[k]} name={ctx.names[ctx.cs.segments[k]?.speaker_label]} onClick={() => ctx.focus(k)} />))}
            </div>
            {ctx.cs.segments[lastSeg] && <p className="spoken line-clamp-2 text-[14.5px] text-slate">“{ctx.cs.segments[lastSeg].text}”</p>}
          </div>
        )}

        {ctx.editable && item.plan && item.state === 'proposed' && (item.plan.calendar_event || item.plan.in_app_reminder_at) && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-faint">
            <span>On approval:</span>
            {item.plan.calendar_event && <span className="inline-flex items-center gap-1"><CalendarClock size={13} />calendar entry on the due date</span>}
            {item.plan.in_app_reminder_at && <span className="inline-flex items-center gap-1"><Check size={13} />in-app reminder {fmtDateTime(item.plan.in_app_reminder_at)}</span>}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.history.length > 0 && (
            <details className="group mr-auto">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-sky hover:underline">
                <span className="inline-flex items-center gap-1"><ChevronRight size={13} className="transition-transform group-open:rotate-90" />How this was worked out ({item.history.length} step{item.history.length === 1 ? '' : 's'})</span>
              </summary>
              <ol className="mt-2 space-y-1 border-l border-rule pl-3 text-[13px]">
                {item.history.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tnum w-4 shrink-0 text-faint">{i + 1}</span>
                    <span className="min-w-0"><span className="font-medium text-ink">{h.type.toLowerCase().replace(/_/g, ' ')}</span><span className="text-slate">: {h.summary}</span>{' '}
                      {h.segment_ids.map(k => <button key={k} className="text-faint hover:text-sky" onClick={() => ctx.focus(k)}>{k} </button>)}</span>
                  </li>))}
              </ol>
            </details>
          )}
          {canAct && !editing && (
            <div className="ml-auto flex flex-wrap gap-2">
              {item.state !== 'tentative' && !['drop', 'none'].includes(item.operation) && <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>Edit</Button>}
              {item.state === 'tentative' && <Button size="sm" icon={<Plus size={13} />} onClick={() => onPromote(item)}>Make it a task</Button>}
              {['create', 'update', 'cancel', 'complete', 'hold'].includes(item.operation) && (
                item.excluded ? <Button size="sm" icon={<Undo2 size={13} />} onClick={() => ctx.patch({ items: { [item.key]: { excluded: false } } })}>Include again</Button>
                  : <Button size="sm" kind="ghost" icon={<X size={13} />} onClick={() => ctx.patch({ items: { [item.key]: { excluded: true } } })}>Exclude</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function UnchangedRow({ item, ctx }: { item: ProposalItem; ctx: Ctx }) {
  const [open, setOpen] = useState(false)
  const why = item.history[item.history.length - 1]?.summary
  return (
    <li onMouseEnter={() => ctx.hover(item.evidence_segment_ids)} onMouseLeave={() => ctx.hover(null)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-panel-2">
        <ChevronRight size={14} className={`text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="tnum text-[12.5px] font-medium text-slate">{item.existing_task_id}</span>
        <span className="min-w-0 flex-1 basis-[12rem] font-medium text-ink">{item.title}</span>
        {why && <span className="min-w-0 text-[13px] text-faint">{why}</span>}
        <span className="flex gap-1">{item.evidence_segment_ids.map(k => <span key={k} className="text-[12px] text-faint">{k}</span>)}</span>
      </button>
      {open && <div className="border-t border-rule bg-paper/40 p-3"><ItemCard item={item} ctx={ctx} onPromote={() => {}} /></div>}
    </li>
  )
}

function AnsweredList({ items, ctx }: { items: Clarification[]; ctx: Ctx }) {
  const label = (c: Clarification) => {
    const a = c.answer!
    const v = a.value ? ` ${a.value}` : ''
    return ({ link: `same as${v}`, set_owner: `owner set to${v}`, set_due: `due${v}`, keep_task: 'keep the task', cancel_task: 'cancel the task',
      unassigned: 'leave unassigned', accepted: 'accepted', new: 'a new task', keep: 'keep it', cancel: 'cancelled', no_deadline: 'no deadline',
      drop: 'dropped', confirm: 'confirmed', drop_dependency: 'dependency removed' } as Record<string, string>)[a.choice] ?? a.choice.replace(/_/g, ' ')
  }
  return (
    <ul className="space-y-1.5">
      {items.map(c => (
        <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <Chip tone="done" icon={<Check size={12} />}>{(Q_KIND[c.kind]?.label ?? 'Question')}</Chip>
          <span className="text-slate">{label(c)}</span>
          {ctx.editable && <Button kind="quiet" size="sm" disabled={ctx.busy}
            onClick={() => ctx.patch({ answers: { [`${c.item_keys[0]}|${c.kind}`]: null } })}>Change answer</Button>}
        </li>))}
    </ul>
  )
}

function QuestionCard({ c, ctx, onMapSpeaker }: { c: Clarification; ctx: Ctx; onMapSpeaker: (label: string, name: string) => Promise<void> }) {
  const [val, setVal] = useState('')
  const cands = (c.data.candidates as string[] | undefined) ?? []
  const meta = Q_KIND[c.kind] ?? { label: 'Question', icon: <HelpCircle size={15} /> }
  const answer = (choice: string, value?: string | null) =>
    ctx.patch({ answers: { [`${c.item_keys[0]}|${c.kind}`]: { choice, value: value ?? null } } })
  const ownerKinds = ['missing_owner', 'group_owner', 'pending_acceptance']
  const dis = !ctx.editable || ctx.busy
  return (
    <li onMouseEnter={() => ctx.hover(c.segment_ids)} onMouseLeave={() => ctx.hover(null)}
      className="rounded-xl border border-ask/30 bg-panel px-4 py-3.5 shadow-soft">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ask">{meta.icon}{meta.label}</div>
      <p className="text-[14.5px] text-ink">{c.question}</p>
      {c.segment_ids.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.segment_ids.map(k => <SegmentChip key={k} segKey={k} seg={ctx.cs.segments[k]} name={ctx.names[ctx.cs.segments[k]?.speaker_label]} onClick={() => ctx.focus(k)} />)}
        </div>
      )}
      {ctx.editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {c.kind === 'unmapped_speaker' && c.data.speaker_label && (
            <>
              <input aria-label="Person's name" list="people" className={`${inputCls} h-8 max-w-[15rem]`} placeholder={`Who is ${c.data.speaker_label}?`} value={val} onChange={e => setVal(e.target.value)} />
              <Button kind="primary" size="sm" disabled={dis || !val.trim()} onClick={() => onMapSpeaker(String(c.data.speaker_label), val.trim())}>Map speaker</Button>
              <Button size="sm" disabled={dis} onClick={() => answer('unassigned')}>Leave unassigned</Button>
            </>
          )}
          {ownerKinds.includes(c.kind) && (
            <>
              {c.kind === 'pending_acceptance' && c.data.candidate && <Button kind="primary" size="sm" disabled={dis} onClick={() => answer('accepted')}>Yes, {String(c.data.candidate)} accepted</Button>}
              <input aria-label="Owner" list="people" className={`${inputCls} h-8 max-w-[12rem]`} placeholder="Owner" value={val} onChange={e => setVal(e.target.value)} />
              <Button size="sm" disabled={dis || !val.trim()} onClick={() => answer('set_owner', val.trim())}>Set owner</Button>
              <Button size="sm" kind="ghost" disabled={dis} onClick={() => answer('unassigned')}>Leave unassigned</Button>
            </>
          )}
          {c.kind === 'ambiguous_deadline' && (
            <>
              {cands.map(d => <Button key={d} size="sm" disabled={dis} onClick={() => answer('set_due', d)}>{fmtDate(d)}</Button>)}
              <input aria-label="Due date" type="date" className={`${inputCls} h-8 max-w-[11rem]`} value={val} onChange={e => setVal(e.target.value)} />
              <Button size="sm" disabled={dis || !val} onClick={() => answer('set_due', val)}>Use this date</Button>
              <Button size="sm" kind="ghost" disabled={dis} onClick={() => answer('no_deadline')}>No deadline</Button>
            </>
          )}
          {c.kind === 'ambiguous_cancellation_existing' && (<><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('cancel_task')}>Cancel the whole task</Button><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('keep_task')}>Keep the task</Button></>)}
          {c.kind === 'ambiguous_cancellation_new' && (<><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('cancel')}>It is cancelled</Button><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('keep')}>Keep it</Button></>)}
          {['possible_existing_match', 'ambiguous_reference'].includes(c.kind) && (
            <>{cands.filter(x => /^TASK-/.test(x)).map(t => <Button key={t} size="sm" kind="primary" disabled={dis} onClick={() => answer('link', t)}>Same as {t}</Button>)}
              <Button size="sm" disabled={dis} onClick={() => answer('new')}>It is a new task</Button></>
          )}
          {c.kind === 'unverified_reference' && (<><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('confirm')}>Yes, that task</Button><Button size="sm" disabled={dis} onClick={() => answer('new')}>A new task</Button><Button size="sm" kind="danger" disabled={dis} onClick={() => answer('drop')}>Drop it</Button></>)}
          {c.kind === 'instruction_to_assistant' && (<><Button size="sm" kind="primary" disabled={dis} onClick={() => answer('drop')}>Not a team action</Button><Button size="sm" disabled={dis} onClick={() => answer('keep')}>It is a genuine action</Button></>)}
          {c.kind === 'missing_prerequisite' && <Button size="sm" disabled={dis} onClick={() => answer('drop_dependency')}>Remove this dependency</Button>}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export default function ReviewPage() {
  const { meetingId } = useParams()
  if (!meetingId) return <ChangeSetList />
  return <Review mid={Number(meetingId)} />
}

const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const SUMMARY = {
  create: (n: number) => pl(n, 'new task', 'new tasks'), owner: (n: number) => pl(n, 'reassignment', 'reassignments'),
  due: (n: number) => pl(n, 'deadline change', 'deadline changes'), cancel: (n: number) => pl(n, 'cancellation', 'cancellations'),
  complete: (n: number) => pl(n, 'completion', 'completions'), hold: (n: number) => `${n} on hold`,
}

function Summary({ items, questions }: { items: ProposalItem[]; questions: number }) {
  const live = items.filter(i => !i.excluded)
  const count = (k: Kind) => live.filter(i => kindsOf(i).includes(k)).length
  const parts: [Kind | 'q', number][] = [['create', count('create')], ['owner', count('owner')], ['due', count('due')],
    ['cancel', count('cancel')], ['complete', count('complete')], ['hold', count('hold')], ['q', questions]]
  const shown = parts.filter(([, n]) => n > 0)
  if (!shown.length) return null
  return (
    <div className="mb-6 flex flex-wrap gap-2" aria-label="Summary of proposed changes">
      {shown.map(([k, n]) => k === 'q'
        ? <Chip key="q" tone="ask" icon={<HelpCircle size={13} />}>{n} question{n === 1 ? '' : 's'} open</Chip>
        : <Chip key={k} tone={KIND[k].tone} icon={KIND[k].icon}>{SUMMARY[k as keyof typeof SUMMARY](n)}</Chip>)}
    </div>
  )
}

function useWide() {
  const q = '(min-width: 1280px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const h = () => setWide(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return wide
}

type ApplyResult = { created?: Record<string, string>; updated?: string[]; cancelled?: string[]; completed?: string[]; idempotent_replay?: boolean }
function describe(res: ApplyResult) {
  const created = Object.values(res.created ?? {})
  return [created.length && `created ${created.join(', ')}`, res.updated?.length && `updated ${res.updated.join(', ')}`,
    res.cancelled?.length && `cancelled ${res.cancelled.join(', ')}`, res.completed?.length && `marked done ${res.completed.join(', ')}`]
    .filter(Boolean).join('; ')
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function Review({ mid }: { mid: number }) {
  const toast = useToast()
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [cs, meeting] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`)])
    return { cs, meeting }
  }, [mid])
  const [busy, setBusy] = useState(false)
  const [focusSeg, setFocusSeg] = useState<Focus | null>(null)
  const [hl, setHl] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [promote, setPromote] = useState<ProposalItem | null>(null)
  const [promoteForm, setPromoteForm] = useState({ owner: '', due: '' })
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const wide = useWide()
  const board = useLoad(() => api.get<Task[]>('/api/tasks'))

  useEffect(() => {
    const st = data?.meeting.source_type
    if (st === 'audio' || st === 'video') api.get<{ url: string }>(`/api/meetings/${mid}/media-url`).then(r => setAudioUrl(r.url)).catch(() => setAudioUrl(null))
  }, [mid, data?.meeting.source_type])

  const derived = useMemo(() => {
    if (!data) return null
    const { cs, meeting } = data
    const p = cs.proposal
    const live = ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW', 'DRAFT'].includes(cs.state)
    const excluded = new Set(p.items.filter(i => i.excluded).map(i => i.key))
    // A question only on excluded items no longer blocks approval (the server ignores it too).
    const relevant = (c: Clarification) => !c.deferred && !(c.item_keys.length > 0 && c.item_keys.every(k => excluded.has(k)))
    return {
      names: Object.fromEntries(meeting.participants.map(x => [x.speaker_label, x.display_name])) as Record<string, string | null>,
      people: [...new Set(meeting.participants.map(x => x.display_name).filter(Boolean) as string[])],
      openQs: live ? p.clarifications.filter(c => relevant(c) && !c.answer).sort((a, b) => a.rank - b.rank) : [],
      answered: p.clarifications.filter(c => relevant(c) && c.answer),
      actionable: p.items.filter(i => i.state === 'proposed' && !i.excluded && ['create', 'update', 'cancel', 'complete', 'create_completed'].includes(i.operation)),
      existing: p.items.filter(i => i.existing_task_id && !['tentative', 'cancelled', 'rejected'].includes(i.state) && i.operation !== 'none'),
      unchanged: p.items.filter(i => i.existing_task_id && i.operation === 'none'),
      fresh: p.items.filter(i => !i.existing_task_id && ['proposed', 'needs_clarification', 'held', 'excluded'].includes(i.state)),
      other: p.items.filter(i => ['tentative', 'cancelled', 'rejected', 'completed'].includes(i.state) && !i.existing_task_id),
      segments: Object.entries(cs.segments).map(([seg_key, s]) => ({ seg_key, ...s })).sort((a, b) => a.start_seconds - b.start_seconds),
    }
  }, [data])

  // The proposal was checked against the open tasks in ledger_snapshot; if the board moved on, it must be re-checked.
  const openNow = board.data?.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).map(t => `${t.code}@${t.revision}`).sort().join()
  const checked = data?.cs.ledger_snapshot?.map(t => `${t.code}@${t.revision}`).sort().join()

  if (loading && !data) return <Loading rows={4} />
  if (!data || !derived) return <ErrorBox error={error} onRetry={reload} />
  const { cs, meeting } = data
  const p = cs.proposal
  const editable = ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW', 'DRAFT'].includes(cs.state)
  const stale = editable && (conflict || (openNow !== undefined && checked !== undefined && openNow !== checked))

  async function act(fn: () => Promise<ChangeSet | void>, ok?: string) {
    setBusy(true)
    try { const r = await fn(); if (r) setData({ cs: r, meeting }); else await reload(); if (ok) toast('ok', ok) }
    catch (e) { toast('error', errText(e)) } finally { setBusy(false) }
  }
  const ar = cs.applied_result
  const ctx: Ctx = {
    cs, names: derived.names, people: derived.people, editable, busy,
    applied: it => cs.state !== 'APPLIED' ? null
      : ar.created?.[it.key] ? `Created ${ar.created[it.key]}`
      : it.existing_task_id && ar.updated?.includes(it.existing_task_id) ? `Updated ${it.existing_task_id}`
      : it.existing_task_id && ar.cancelled?.includes(it.existing_task_id) ? `Cancelled ${it.existing_task_id}`
      : it.existing_task_id && ar.completed?.includes(it.existing_task_id) ? `Marked ${it.existing_task_id} done` : null,
    focus: k => { if (!wide) setDrawer(true); setFocusSeg({ key: k, n: Date.now() }) },
    hover: keys => setHl(new Set(keys ?? [])),
    patch: body => act(() => api.patch<ChangeSet>(`/api/changesets/${cs.id}`, body)),
  }
  const mapSpeaker = (label: string, name: string) => act(async () => {
    await api.put(`/api/meetings/${mid}/participants/${encodeURIComponent(label)}`, { display_name: name, confirmed_identity: true })
    const [cs2, m2] = await Promise.all([api.get<ChangeSet>(`/api/meetings/${mid}/changeset`), api.get<MeetingDetail>(`/api/meetings/${mid}`)])
    setData({ cs: cs2, meeting: m2 })
  }, `${label} mapped to ${name}. Proposals re-checked without calling the model.`)
  const approve = () => act(async () => {
    try {
      const r = await api.post<{ change_set: ChangeSet; result: ApplyResult }>(`/api/changesets/${cs.id}/approve`, { proposal_hash: cs.proposal_hash })
      toast('ok', <>Approved{r.result.idempotent_replay ? ' (already applied; nothing duplicated)' : ''}: {describe(r.result) || 'no task changes'}. <Link className="font-medium text-sky hover:underline" to="/tasks">Open the task board</Link></>)
      board.reload()
      return r.change_set
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /changed since it was reviewed/.test(e.message)) setConflict(true)
      throw e
    }
  })
  const recheck = () => act(async () => {
    const r = await api.post<ChangeSet>(`/api/meetings/${mid}/changeset/recompute`)
    setConflict(false); board.reload()
    return r
  }, 'Re-checked against the current task board without calling the model. Review it, then approve.')
  const doReject = () => act(async () => { const r = await api.post<ChangeSet>(`/api/changesets/${cs.id}/reject`, { reason: reason || null }); setRejectOpen(false); return r }, 'Proposed changes rejected. Nothing was applied.')
  const doPromote = () => promote && act(async () => {
    const e: Record<string, unknown> = { promote: true, owner: promoteForm.owner.trim() }
    if (promoteForm.due) e.due_date = promoteForm.due
    const r = await api.patch<ChangeSet>(`/api/changesets/${cs.id}`, { items: { [promote.key]: e } })
    setPromote(null); return r
  }, 'Suggestion turned into a proposed task.')

  const transcriptPanel = (
    <Transcript segments={derived.segments} names={derived.names} focus={focusSeg} highlight={hl} audio={audio} hasAudio={!!audioUrl}
      maxHeight={wide ? `calc(100vh - ${audioUrl ? 15.5 : 12}rem)` : undefined} />
  )
  const isAudio = meeting.source_type === 'audio' || meeting.source_type === 'video'
  const models = [...new Set(meeting.llm_runs.map(r => `${r.provider}/${r.model}`))]
  const nLedger = cs.ledger_snapshot?.length ?? 0

  return (
    <div className="pb-10">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-[13px] text-faint"><Link to="/review" className="shrink-0 hover:text-ink">Review changes</Link><ChevronRight size={13} aria-hidden className="shrink-0" /><span className="min-w-0 truncate" aria-current="page">{meeting.title}</span></nav>
      <PageHeader title={meeting.title}
        sub={<>Proposed from the meeting on {fmtDate(meeting.scheduled_at)} ({meeting.timezone}). Nothing here changes the task board until you approve it.</>}
        meta={<>
          <StateChip state={cs.state} />
          <Chip icon={isAudio ? <FileAudio size={12} /> : <FileText size={12} />}>{isAudio ? `Audio, transcribed by ${meeting.stt_provider ?? 'unknown'}` : 'Imported transcript'}</Chip>
          {models.length > 0 && <Chip icon={<Sparkles size={12} />}>{models.join(', ')}</Chip>}
          <span className="text-[12.5px] text-faint">Version {cs.version}, checked against {nLedger} approved task{nLedger === 1 ? '' : 's'}</span>
        </>}>
        {!wide && <Button icon={<MessageSquareQuote size={15} />} onClick={() => setDrawer(true)}>Transcript</Button>}
        <Link to={`/meetings/${mid}`} className="inline-flex h-8 items-center rounded-md border border-rule-strong bg-panel-2 px-3 text-[13.5px] font-medium transition-colors hover:bg-panel-3">Open meeting</Link>
      </PageHeader>

      <Summary items={p.items} questions={derived.openQs.length} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-8">
          {cs.state === 'APPLIED' && (
            <section className="anim-in rounded-xl border border-done/30 bg-done-soft px-4 py-3.5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-done"><CheckCircle2 size={17} />Approved and applied</h2>
              <p className="mt-1 text-[14px] text-ink">{cap(describe(cs.applied_result)) || 'No task changes were needed'}. <Link className="font-medium text-sky hover:underline" to="/tasks">Open the task board</Link></p>
            </section>
          )}
          {stale && (
            <Notice tone="ask" icon={<RefreshCw size={16} />}>
              <p><span className="font-medium">The task board changed after this proposal was checked</span> (another meeting was approved or a task was edited). Re-check it so you approve changes against the board as it is now. Your answers and edits are kept.</p>
              <Button className="mt-2" size="sm" kind="primary" icon={<RefreshCw size={14} />} loading={busy} onClick={recheck}>Re-check against the current board</Button>
            </Notice>
          )}
          {cs.state === 'FAILED' && <Notice tone="cancel">Applying failed and nothing was written: {cs.error}</Notice>}
          {cs.state === 'REJECTED' && <Notice tone="neutral">These proposed changes were rejected. Nothing was applied.</Notice>}

          {derived.openQs.length > 0 && (
            <section>
              <h2 className="mb-1 text-[16px] font-semibold">Needs your decision <span className="ml-1 font-normal text-faint tnum">{derived.openQs.length}</span></h2>
              <p className="mb-3 text-[13.5px] text-slate">Ordered by how much each one blocks: whether the work exists first, then ownership, then dates.</p>
              <ul className="space-y-3">{derived.openQs.map(c => <QuestionCard key={c.id} c={c} ctx={ctx} onMapSpeaker={mapSpeaker} />)}</ul>
            </section>
          )}

          {([['Changes to existing tasks', derived.existing], ['New tasks', derived.fresh], ['Not becoming tasks', derived.other]] as [string, ProposalItem[]][])
            .map(([title, items]) => items.length > 0 && (
              <section key={title}>
                <h2 className="mb-3 text-[16px] font-semibold">{title} <span className="ml-1 font-normal text-faint tnum">{items.length}</span></h2>
                <div className="space-y-3">{items.map(i => <ItemCard key={i.key} item={i} ctx={ctx} onPromote={it => { setPromoteForm({ owner: it.owner ?? '', due: it.deadline.date ?? '' }); setPromote(it) }} />)}</div>
              </section>
            ))}

          {derived.unchanged.length > 0 && (
            <section>
              <h2 className="mb-3 text-[16px] font-semibold">Mentioned, no change <span className="ml-1 font-normal text-faint tnum">{derived.unchanged.length}</span></h2>
              <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-panel">
                {derived.unchanged.map(i => <UnchangedRow key={i.key} item={i} ctx={ctx} />)}
              </ul>
            </section>
          )}

          {p.decisions_review.length > 0 && (
            <section>
              <h2 className="mb-3 text-[16px] font-semibold">Decisions to record <span className="ml-1 font-normal text-faint tnum">{p.decisions_review.length}</span></h2>
              <ul className="space-y-3">{p.decisions_review.map(d => (
                <li key={d.id} className="rounded-xl border border-rule bg-panel px-4 py-3.5 shadow-soft">
                  <label className="flex items-start gap-2.5 font-medium">
                    <input type="checkbox" className="mt-1 accent-[var(--accent)]" disabled={!editable || busy} checked={d.include}
                      onChange={e => ctx.patch({ decisions: { [d.id]: { include: e.target.checked } } })} />{d.text}
                  </label>
                  <p className="ml-6 mt-0.5 text-[13.5px] text-slate">{d.rationale ? `Reason given: ${d.rationale}` : 'No reason was extracted; check the quote.'}</p>
                  <div className="ml-6 mt-2 flex flex-wrap gap-1.5">{d.evidence_segment_ids.map(k => <SegmentChip key={k} segKey={k} seg={cs.segments[k]} name={derived.names[cs.segments[k]?.speaker_label]} onClick={() => ctx.focus(k)} />)}</div>
                </li>))}
              </ul>
            </section>
          )}

          {(p.warnings.length > 0 || p.rejected_events.length > 0 || (p.uncovered_segment_ids ?? []).length > 0 || derived.answered.length > 0) && (
            <Panel title="Checks" icon={<ShieldAlert size={15} />}>
              <ul className="space-y-2.5 text-[13.5px]">
                {p.warnings.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Chip tone={w.kind === 'possible_prompt_injection' ? 'cancel' : 'neutral'}>{w.kind.replace(/_/g, ' ')}</Chip>
                    <span className="text-slate">{w.detail}</span>
                    {w.segment_ids.map(k => <SegmentChip key={k} segKey={k} seg={cs.segments[k]} onClick={() => ctx.focus(k)} />)}
                  </li>))}
                {p.rejected_events.map((r, i) => <li key={`r${i}`} className="flex flex-wrap items-center gap-2"><Chip tone="cancel">rejected model output</Chip><span className="text-slate">{r.reason}</span></li>)}
                {(p.uncovered_segment_ids ?? []).length > 0 && (
                  <li className="flex flex-wrap items-center gap-2"><Chip tone="ask">nothing extracted</Chip><span className="text-slate">These lines produced no commitment. Check that nothing was missed:</span>
                    {(p.uncovered_segment_ids ?? []).map(k => <SegmentChip key={k} segKey={k} seg={cs.segments[k]} onClick={() => ctx.focus(k)} />)}</li>
                )}
                {derived.answered.length > 0 && <li><div className="mb-1.5 text-faint">Your answers, applied to the items above:</div><AnsweredList items={derived.answered} ctx={ctx} /></li>}
              </ul>
            </Panel>
          )}

          {editable && (
            <div className="sticky bottom-3 z-10">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule-strong bg-panel-2/95 px-4 py-3 shadow-soft backdrop-blur">
                <p className="flex min-w-0 items-center gap-2 text-[13.5px]">
                  {stale
                    ? <><RefreshCw size={16} className="shrink-0 text-ask" /><span className="text-ink">The task board changed. Re-check this proposal before approving.</span></>
                    : cs.state === 'NEEDS_CLARIFICATION'
                    ? <><HelpCircle size={16} className="shrink-0 text-ask" /><span className="text-ink">Answer {derived.openQs.length} open question{derived.openQs.length === 1 ? '' : 's'}, or exclude those items, to approve.</span></>
                    : <><CheckCircle2 size={16} className="shrink-0 text-create" /><span className="text-ink">Approving applies {derived.actionable.length} change{derived.actionable.length === 1 ? '' : 's'} exactly as shown</span><span className="hidden text-faint md:inline">(version {cs.version}, {cs.proposal_hash.slice(0, 8)})</span></>}
                </p>
                <div className="flex gap-2">
                  <Button kind="ghost" onClick={() => setRejectOpen(true)} disabled={busy}>Reject all</Button>
                  <Button kind="primary" icon={<Check size={15} />} onClick={approve} loading={busy} disabled={stale || cs.state !== 'READY_FOR_REVIEW'}>
                    {`Approve ${derived.actionable.length} change(s)`}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {wide && (
          <aside className="sticky top-6 self-start">
            <div className="overflow-hidden rounded-xl border border-rule bg-panel shadow-soft">
              <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold"><MessageSquareQuote size={15} className="text-faint" />Source transcript</h2>
                <span className="text-[12px] text-faint">{derived.segments.length} segments</span>
              </div>
              {audioUrl && <div className="border-b border-rule px-3 py-2"><audio ref={audio} controls preload="metadata" src={audioUrl} className="h-9 w-full" aria-label="Meeting recording" /></div>}
              {transcriptPanel}
              <p className="border-t border-rule px-4 py-2 text-[12px] text-faint">Timestamps are per segment, not per word. Hover a card to see its lines; click a chip to jump.</p>
            </div>
          </aside>
        )}
      </div>

      {!wide && (
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Source transcript" sub={meeting.title} width={520}>
          {audioUrl && <audio ref={audio} controls preload="metadata" src={audioUrl} className="mb-3 h-9 w-full" aria-label="Meeting recording" />}
          {transcriptPanel}
        </Drawer>
      )}

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject all proposed changes?"
        footer={<><Button onClick={() => setRejectOpen(false)}>Keep reviewing</Button><Button kind="danger" loading={busy} onClick={doReject}>Reject all</Button></>}>
        <p className="mb-3 text-slate">Nothing from this meeting will be applied to the task board. You can re-run the analysis later to get a new proposal.</p>
        <Field label="Reason (optional)"><textarea className={`${inputCls} h-20 py-2`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></Field>
      </Dialog>

      <Dialog open={!!promote} onClose={() => setPromote(null)} title="Make this suggestion a task"
        footer={<><Button onClick={() => setPromote(null)}>Cancel</Button><Button kind="primary" loading={busy} disabled={!promoteForm.owner.trim()} onClick={doPromote}>Add as proposed task</Button></>}>
        <p className="mb-3 text-slate">“{promote?.title}” was only suggested in the meeting. A task needs an owner, and it will still go through approval.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner"><input data-autofocus className={inputCls} list="people" value={promoteForm.owner} onChange={e => setPromoteForm({ ...promoteForm, owner: e.target.value })} /></Field>
          <Field label="Due date (optional)"><input type="date" className={inputCls} value={promoteForm.due} onChange={e => setPromoteForm({ ...promoteForm, due: e.target.value })} /></Field>
        </div>
      </Dialog>

      {derived.people.length > 0 && <datalist id="people">{derived.people.map(x => <option key={x} value={x} />)}</datalist>}
      <p className="sr-only" aria-live="polite">{stateLabel(cs.state)}</p>
    </div>
  )
}
