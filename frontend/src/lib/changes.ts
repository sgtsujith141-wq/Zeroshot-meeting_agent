// What approving a change set will actually write to the task board.
//
// These rules mirror backend/app/services/changesets.py `_apply` exactly; the review screen
// must never show a change that approval does not make, or hide one that it does:
// - only items in state "proposed" with an actionable operation are applied;
// - a new task gets the proposed title, owner, due date and priority;
// - an update sets the owner, sets the due date only when it differs, marks the task blocked
//   if a blocked reason is proposed, sets the priority unless the organiser set it on the
//   board, and only ever ADDS dependencies; it never renames the task;
// - a dependency is recorded only when its prerequisite exists on the board or is created by
//   the same approval.
import type { Tone } from '../components/ui'
import type { ChangeSet, Clarification, ProposalItem, Task, TaskDetail } from '../types'
import { fmtDate } from './api'
import { taskLabel } from './status'

export const ACTIONABLE = ['create', 'update', 'cancel', 'complete', 'create_completed']
export const OWNER_KINDS = ['missing_owner', 'group_owner', 'pending_acceptance', 'unmapped_speaker']

export interface FieldChange { field: 'Title' | 'Owner' | 'Due' | 'Priority' | 'Status' | 'Waits for'; from: string | null; to: string }
export interface Planned {
  item: ProposalItem
  task: Task | null
  applies: boolean
  group: 'apply' | 'waiting' | 'none'
  action: string
  changes: FieldChange[]
  notes: string[]
  status: { label: string; tone: Tone }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const owner = (v: string | null | undefined) => v || 'Unassigned'
const due = (v: string | null | undefined) => (v ? fmtDate(v) : 'No date')
const prio = (v: string | null | undefined) => (v ? cap(v) : 'Not set')

const NOT_APPLIED: Record<string, { action: string; label: string; tone: Tone; note: string; group: Planned['group'] }> = {
  needs_clarification: { action: 'Needs an answer', label: 'Needs an answer', tone: 'ask', group: 'waiting', note: 'Answer its question first. Approval is not possible until every open question is answered or its item is excluded.' },
  held: { action: 'On hold', label: 'On hold', tone: 'ask', group: 'waiting', note: 'Held until its question is answered.' },
  excluded: { action: 'Excluded', label: 'Excluded', tone: 'neutral', group: 'none', note: 'You excluded this. Approval ignores it.' },
  tentative: { action: 'Suggestion only', label: 'Not a task', tone: 'neutral', group: 'none', note: 'Only suggested in the meeting. It becomes a task only if you make it one.' },
  cancelled: { action: 'Dropped in the meeting', label: 'Not a task', tone: 'neutral', group: 'none', note: 'Cancelled in the meeting, so nothing is created.' },
  rejected: { action: 'Ruled out', label: 'Not a task', tone: 'neutral', group: 'none', note: 'Ruled out in the meeting.' },
  completed: { action: 'Reported done', label: 'Not added', tone: 'neutral', group: 'none', note: 'Reported as already finished. It is not added to the board.' },
  no_change: { action: 'No change', label: 'No change', tone: 'neutral', group: 'none', note: 'Mentioned in the meeting; nothing about the task changes.' },
}

const VERB: Record<FieldChange['field'], string> = {
  Title: 'rename', Owner: 'reassign', Due: 'move deadline', Priority: 'change priority', Status: 'change status', 'Waits for': 'add dependency',
}

/** Short description of a set of field changes, e.g. "Reassign, move deadline". */
export function actionFor(changes: FieldChange[], isNew: boolean): string {
  if (isNew) return 'New task'
  const v = changes.map(c => (c.field === 'Status' ? `mark ${c.to.toLowerCase()}` : VERB[c.field])).filter((x, i, a) => a.indexOf(x) === i)
  return v.length ? cap(v.join(', ')) : 'No field change'
}

export function plan(cs: ChangeSet, board: Task[]): Planned[] {
  const byCode = new Map(board.map(t => [t.code, t]))
  const items = cs.proposal.items
  const applies = (i: ProposalItem) => i.state === 'proposed' && ACTIONABLE.includes(i.operation)
  const created = new Set(items.filter(i => applies(i) && (i.operation === 'create' || i.operation === 'create_completed')).map(i => i.key))
  const ar = cs.applied_result ?? {}

  return items.map(item => {
    const task = item.existing_task_id ? byCode.get(item.existing_task_id) ?? null : null
    const changes: FieldChange[] = []
    const notes: string[] = []
    const deps = item.depends_on.map(d => ({
      label: d.existing_task_id ? `${d.existing_task_id} ${d.title}` : d.title,
      code: d.existing_task_id,
      ok: d.existing_task_id ? byCode.has(d.existing_task_id) : created.has(d.key),
      title: d.title,
    }))
    const op = item.operation
    let action = ''

    if (op === 'create' || op === 'create_completed' || (!item.existing_task_id && NOT_APPLIED[item.state]?.group === 'waiting')) {
      action = op === 'create_completed' ? 'Add as done' : 'New task'
      changes.push({ field: 'Owner', from: null, to: owner(item.owner) }, { field: 'Due', from: null, to: due(item.deadline.date) })
      if (item.priority.value) changes.push({ field: 'Priority', from: null, to: prio(item.priority.value) })
      if (op === 'create_completed') changes.push({ field: 'Status', from: null, to: 'Done' })
      for (const d of deps) {
        if (d.ok) changes.push({ field: 'Waits for', from: null, to: d.label })
        else notes.push(`Waits for “${d.title}” is not recorded: that item is not becoming a task.`)
      }
    } else if (op === 'cancel' || op === 'complete') {
      action = op === 'cancel' ? 'Cancel task' : 'Mark done'
      changes.push({ field: 'Status', from: task ? taskLabel(task.status) : null, to: op === 'cancel' ? 'Cancelled' : 'Done' })
    } else if (item.existing_task_id) {
      if (!task) notes.push(`${item.existing_task_id} is no longer on the board; approving would fail. Re-check against the current board.`)
      else {
        if ((item.owner ?? null) !== (task.owner ?? null)) changes.push({ field: 'Owner', from: owner(task.owner), to: owner(item.owner) })
        if ((item.deadline.date ?? null) !== (task.due_date ?? null)) changes.push({ field: 'Due', from: due(task.due_date), to: due(item.deadline.date) })
        if (item.blocked_reason && task.status !== 'blocked') changes.push({ field: 'Status', from: taskLabel(task.status), to: 'Blocked' })
        if (item.priority.value && task.priority_basis !== 'set by organiser' && item.priority.value !== task.priority)
          changes.push({ field: 'Priority', from: prio(task.priority), to: prio(item.priority.value) })
        const have = new Set(task.prerequisites.map(p => p.code))
        for (const d of deps) {
          if (!d.ok) notes.push(`Waits for “${d.title}” is not recorded: that item is not becoming a task.`)
          else if (!d.code || !have.has(d.code)) changes.push({ field: 'Waits for', from: null, to: d.label })
        }
        const keep = task.prerequisites.filter(p => !deps.some(d => d.code === p.code))
        if (op === 'update') for (const p of keep) notes.push(`Approval keeps the existing dependency on ${p.code}; it never removes dependencies.`)
        if (item.title !== task.title) notes.push(`The title stays “${task.title}”. Approval does not rename existing tasks.`)
        if (op === 'update' && !changes.length) notes.push('No field changes. This meeting is added as evidence and a new revision is recorded.')
      }
      action = changes.length ? cap(changes.map(c => VERB[c.field]).filter((v, i, a) => a.indexOf(v) === i).join(', ')) : (op === 'update' ? 'Add evidence' : 'No change')
    }

    const willApply = applies(item)
    const na = NOT_APPLIED[item.state]
    let status: Planned['status'] = willApply ? { label: 'Will apply', tone: 'accent' } : { label: na?.label ?? item.state, tone: na?.tone ?? 'neutral' }
    if (!willApply && na) {
      notes.unshift(na.note)
      if (na.group !== 'waiting' || !action) action = na.action
      if (na.group === 'none') changes.length = 0 // never applied: nothing to show as a change
    }
    if (cs.state === 'APPLIED') {
      const code = ar.created?.[item.key]
      status = code ? { label: `Created ${code}`, tone: 'done' }
        : item.existing_task_id && ar.updated?.includes(item.existing_task_id) ? { label: `Updated ${item.existing_task_id}`, tone: 'done' }
        : item.existing_task_id && ar.cancelled?.includes(item.existing_task_id) ? { label: `Cancelled ${item.existing_task_id}`, tone: 'done' }
        : item.existing_task_id && ar.completed?.includes(item.existing_task_id) ? { label: `Marked ${item.existing_task_id} done`, tone: 'done' }
        : { label: 'Not applied', tone: 'neutral' }
    } else if (cs.state === 'REJECTED') status = { label: 'Rejected', tone: 'neutral' }

    return { item, task, applies: willApply, group: willApply ? 'apply' : na?.group ?? 'none', action, changes, notes, status }
  })
}

export function summarize(planned: Planned[]): string {
  const a = planned.filter(p => p.applies)
  const n = (pred: (p: Planned) => boolean) => a.filter(pred).length
  const parts = [
    [n(p => p.item.operation === 'create'), 'new task', 'new tasks'],
    [n(p => p.item.operation === 'create_completed'), 'finished task added', 'finished tasks added'],
    [n(p => p.item.operation === 'update'), 'update', 'updates'],
    [n(p => p.item.operation === 'complete'), 'task marked done', 'tasks marked done'],
    [n(p => p.item.operation === 'cancel'), 'cancellation', 'cancellations'],
  ].filter(([c]) => (c as number) > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`)
  return parts.length ? parts.join(', ') : 'no task changes'
}

// ---- what changed between two versions of a proposal ---------------------------------------

const STATE_WORD: Record<string, string> = {
  proposed: 'ready', needs_clarification: 'needs an answer', held: 'on hold', excluded: 'excluded', tentative: 'suggestion',
  cancelled: 'dropped', rejected: 'ruled out', completed: 'reported done', no_change: 'no change',
}
const qkey = (c: Clarification) => `${c.item_keys[0]}|${c.kind}`

/** Human-readable differences between the proposal before and after an action. */
export function diffProposals(prev: ChangeSet, next: ChangeSet): string[] {
  const out: string[] = []
  const before = new Map(prev.proposal.items.map(i => [i.key, i]))
  for (const n of next.proposal.items) {
    const p = before.get(n.key)
    const name = `“${n.title}”`
    if (!p) { out.push(`New item ${name}`); continue }
    if (p.title !== n.title) out.push(`“${p.title}” is now called ${name}`)
    if ((p.existing_task_id ?? null) !== (n.existing_task_id ?? null)) out.push(n.existing_task_id ? `${name} is now an update to ${n.existing_task_id}` : `${name} is now a new task`)
    if ((p.owner ?? null) !== (n.owner ?? null)) out.push(`${name}: owner ${owner(p.owner)} → ${owner(n.owner)}`)
    if ((p.deadline.date ?? null) !== (n.deadline.date ?? null)) out.push(`${name}: due ${due(p.deadline.date)} → ${due(n.deadline.date)}`)
    if ((p.priority.value ?? null) !== (n.priority.value ?? null)) out.push(`${name}: priority ${prio(p.priority.value)} → ${prio(n.priority.value)}`)
    if (p.state !== n.state) out.push(`${name}: ${STATE_WORD[p.state] ?? p.state} → ${STATE_WORD[n.state] ?? n.state}`)
  }
  for (const p of prev.proposal.items) if (!next.proposal.items.some(n => n.key === p.key)) out.push(`“${p.title}” is no longer proposed`)
  const nq = new Set(next.proposal.clarifications.map(qkey))
  const pq = new Set(prev.proposal.clarifications.map(qkey))
  for (const c of prev.proposal.clarifications) if (!c.answer && !c.deferred && !nq.has(qkey(c))) out.push(`No longer asked: ${c.question}`)
  for (const c of next.proposal.clarifications) if (!c.deferred && !pq.has(qkey(c))) out.push(`New question: ${c.question}`)
  return out
}

// ---- answers that no longer match any question ----------------------------------------------

export interface Orphan { key: string; itemKey: string; kind: string; choice: string; value: string | null; item: ProposalItem | null }

/** Stored answers whose question no longer exists after the server re-ran its rules.
 *  The server ignores them silently, so the organiser must decide what to do. */
export function orphanAnswers(cs: ChangeSet): Orphan[] {
  const answers = (cs.organizer_edits?.answers ?? {}) as Record<string, { choice: string; value: string | null } | null>
  const live = new Set(cs.proposal.clarifications.map(qkey))
  return Object.entries(answers).filter(([k, a]) => a && !live.has(k)).map(([k, a]) => {
    const i = k.lastIndexOf('|')
    const itemKey = k.slice(0, i)
    return { key: k, itemKey, kind: k.slice(i + 1), choice: a!.choice, value: a!.value, item: cs.proposal.items.find(x => x.key === itemKey) ?? null }
  })
}

export function answerLabel(choice: string, value: string | null) {
  const v = value ? ` ${value}` : ''
  return ({
    link: `same task as${v}`, set_owner: `owner${v}`, set_due: `due ${value ? fmtDate(value) : ''}`, keep_task: 'keep the task', cancel_task: 'cancel the task',
    unassigned: 'leave unassigned', accepted: 'accepted', new: 'a new task', keep: 'keep it', cancel: 'it is cancelled', no_deadline: 'no deadline',
    drop: 'drop it', confirm: 'yes, that task', drop_dependency: 'remove the dependency',
  } as Record<string, string>)[choice] ?? choice.replace(/_/g, ' ')
}

export const Q_LABEL: Record<string, string> = {
  unmapped_speaker: 'Who is this speaker?', missing_owner: 'Who owns this?', group_owner: 'Which single person owns this?',
  pending_acceptance: 'Did they accept?', ambiguous_deadline: 'Which date?', ambiguous_cancellation_existing: 'Cancel the task or only a plan?',
  ambiguous_cancellation_new: 'Is it cancelled?', possible_existing_match: 'Same task or a new one?', ambiguous_reference: 'Which task is meant?',
  unverified_reference: 'Is this the linked task?', instruction_to_assistant: 'Addressed to the assistant', missing_prerequisite: 'Missing prerequisite',
}

// ---- what an approval actually changed (from the task's recorded revisions) -------------------

/** Field changes recorded by the revision this change set created, compared with the revision
 *  before it. Returns null when the task has no revision from this change set. */
export function revisionChanges(t: TaskDetail, csId: number): FieldChange[] | null {
  const i = t.revisions.findIndex(r => r.change_set_id === csId)
  if (i < 0) return null
  const b = t.revisions[i].snapshot as Record<string, string | null>
  const a = i > 0 ? t.revisions[i - 1].snapshot as Record<string, string | null> : null
  const out: FieldChange[] = []
  const cmp = (field: FieldChange['field'], k: string, f: (v: string | null) => string) => {
    if (!a) out.push({ field, from: null, to: f(b[k]) })
    else if ((a[k] ?? null) !== (b[k] ?? null)) out.push({ field, from: f(a[k]), to: f(b[k]) })
  }
  if (a) cmp('Title', 'title', v => v ?? '') // a new task's title is the row itself
  cmp('Owner', 'owner', owner); cmp('Due', 'due_date', due); cmp('Priority', 'priority', prio)
  if (a || b.status !== 'todo') cmp('Status', 'status', v => taskLabel(v ?? ''))
  return out
}
