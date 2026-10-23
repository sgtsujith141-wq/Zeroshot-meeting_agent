import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CalendarPlus, Download, History, KanbanSquare, Link2, MessageSquareQuote, Search, Signal } from 'lucide-react'
import { api, download, fmtDate, fmtDateTime, fmtTime } from '../lib/api'
import type { MeetingSummary, Task, TaskDetail } from '../types'
import { Avatar, Button, Chip, Drawer, Empty, ErrorBox, PageHeader, Skeleton, StateChip, errText, inputCls, stateLabel, useLoad, useToast } from '../components/ui'

const COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const
// Task statuses (the shared labels describe proposal states, e.g. 'Cancelled in meeting').
const taskLabel = (s: string) => (s === 'cancelled' ? 'Cancelled' : stateLabel(s))
const NEEDS_PREREQS = ['in_progress', 'done']
const todayIso = () => new Date().toISOString().slice(0, 10)

function DueChip({ due, open }: { due: string | null; open: boolean }) {
  if (!due) return null
  const t = todayIso()
  const tone = open && due < t ? 'cancel' : open && due === t ? 'ask' : 'neutral'
  return <Chip tone={tone} icon={<CalendarClock size={12} />}>{open && due < t ? 'Overdue, ' : ''}{new Date(due + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Chip>
}

function Priority({ p }: { p: string | null }) {
  if (!p) return null
  const c = p === 'high' ? 'text-cancel' : p === 'medium' ? 'text-ask' : 'text-faint'
  return <span className={`inline-flex items-center gap-1 text-[12.5px] capitalize ${c}`} title={`${p} priority`}><Signal size={12} />{p}</span>
}

function TaskDrawer({ code, onClose, onChanged, meetings }: { code: string; onClose: () => void; onChanged: () => void; meetings: Map<number, MeetingSummary> }) {
  const toast = useToast()
  const { data: t, error, reload } = useLoad(() => api.get<TaskDetail>(`/api/tasks/${code}`), [code])
  const [busy, setBusy] = useState<string | null>(null)
  async function move(status: string) {
    if (!t) return
    setBusy(status)
    try { await api.patch(`/api/tasks/${code}`, { expected_revision: t.revision, status }); toast('ok', `${code} moved to ${taskLabel(status)}.`); await reload(); onChanged() }
    catch (e) { toast('error', errText(e)) } finally { setBusy(null) }
  }
  const waiting = t?.prerequisites.filter(p => p.status !== 'done') ?? []
  return (
    <Drawer open onClose={onClose} title={t?.title ?? code} sub={t ? `${code}, revision ${t.revision}` : code}>
      <ErrorBox error={error} onRetry={reload} />
      {!t ? <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div> : (
        <div className="space-y-6 text-[14px]">
          <div className="flex flex-wrap items-center gap-2">
            <StateChip state={t.status} />
            {t.is_blocked && t.status !== 'blocked' && <Chip tone="cancel" icon={<Link2 size={12} />}>waiting for prerequisites</Chip>}
            <Priority p={t.priority} />
          </div>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate">Move to</h3>
            <div className="flex flex-wrap gap-2">{t.allowed_transitions.map(s => {
              const blocked = NEEDS_PREREQS.includes(s) && waiting.length > 0
              return <Button key={s} size="sm" loading={busy === s} disabled={!!busy || blocked} title={blocked ? `Waiting for ${waiting.map(p => p.code).join(', ')}` : undefined} onClick={() => move(s)}>{taskLabel(s)}</Button>
            })}</div>
            <p className="mt-1.5 text-[12.5px] text-faint">{waiting.length ? `Starting or finishing is disabled until ${waiting.map(p => p.code).join(', ')} is done. The server enforces this too.` : 'Starting or finishing requires every prerequisite to be done.'}</p>
          </section>

          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
            <dt className="text-faint">Owner</dt><dd className="flex items-center gap-2"><Avatar name={t.owner} size={20} />{t.owner ?? 'Unassigned'} <span className="text-[12.5px] text-faint">{t.owner_certainty.replace(/_/g, ' ')}</span></dd>
            <dt className="text-faint">Due</dt><dd>{fmtDate(t.due_date)} {t.deadline_raw && <span className="block text-[12.5px] text-faint">Said “{t.deadline_raw}”, {t.deadline_kind?.replace(/_/g, ' ')}</span>}</dd>
            <dt className="text-faint">Priority</dt><dd>{t.priority ? <span className="capitalize">{t.priority}</span> : 'Not set'} {t.priority_basis && <span className="block text-[12.5px] text-faint">{t.priority_basis}</span>}</dd>
            <dt className="text-faint">Waits for</dt><dd>{t.prerequisites.length ? t.prerequisites.map(p => <span key={p.code} className="mr-2 inline-flex items-center gap-1"><Link2 size={12} className="text-faint" />{p.code} <StateChip state={p.status} /></span>) : 'Nothing'}</dd>
            {t.dependents.length > 0 && <><dt className="text-faint">Blocks</dt><dd>{t.dependents.map(p => p.code).join(', ')}</dd></>}
            <dt className="text-faint">Origin</dt><dd><Link className="text-sky hover:underline" to={`/meetings/${t.origin_meeting_id}`}>{meetings.get(t.origin_meeting_id)?.title ?? `Meeting ${t.origin_meeting_id}`}</Link></dd>
            <dt className="text-faint">Calendar</dt><dd>{t.calendar_event ? (
              <span className="flex flex-wrap items-center gap-2">{fmtDate(t.calendar_event.date)} <span className="text-[12.5px] text-faint">{t.calendar_event.sync_state === 'local' ? 'in-app only' : 'exported as .ics'}</span>
                <Button size="sm" icon={<Download size={13} />} onClick={() => download(`/api/tasks/${code}/event.ics`, `${code}.ics`).catch(e => toast('error', errText(e)))}>.ics</Button></span>) : 'No due date'}</dd>
          </dl>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-slate"><MessageSquareQuote size={14} />Where this came from</h3>
            <ul className="space-y-3">{t.evidence_detail.map((e, i) => (
              <li key={i} className="border-l-2 border-rule-strong pl-3">
                {e.exists ? <p className="spoken text-ink">“{e.text}”</p> : <p className="text-cancel">Segment no longer exists</p>}
                <Link to={`/meetings/${e.meeting_id}#${e.seg_key}`} className="text-[12.5px] text-faint hover:text-sky">{e.meeting_title}, {e.speaker_label} at <span className="tnum">{fmtTime(e.start_seconds)}</span> ({e.seg_key})</Link>
              </li>))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-slate"><History size={14} />Approved history</h3>
            <ol className="relative space-y-3 border-l border-rule pl-4">{t.revisions.map(r => (
              <li key={r.revision} className="text-[13.5px]">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-panel bg-accent" aria-hidden />
                <div className="font-medium text-ink">Revision {r.revision} <span className="font-normal text-faint">{fmtDateTime(r.created_at)}</span></div>
                <div className="text-slate">{r.reason}, by {r.actor}. Owner {String(r.snapshot.owner ?? 'unassigned')}, due {String(r.snapshot.due_date ?? 'none')}, {taskLabel(String(r.snapshot.status))}.</div>
              </li>))}
            </ol>
          </section>

          {t.reminders.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-slate"><CalendarPlus size={14} />Reminders</h3>
              <ul className="space-y-1.5 text-[13.5px]">{t.reminders.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="tnum">{fmtDateTime(r.scheduled_at)}</span><span className="text-faint">{r.channel === 'in_app' ? 'in-app' : 'email'}</span><StateChip state={r.delivery_state} /></li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}

export default function TasksPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [tasks, meetings] = await Promise.all([api.get<Task[]>('/api/tasks'), api.get<MeetingSummary[]>('/api/meetings')])
    return { tasks, meetings: new Map(meetings.map(m => [m.id, m])) }
  })
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')
  const owners = useMemo(() => [...new Set((data?.tasks ?? []).map(t => t.owner ?? ''))].sort(), [data])
  const tasks = (data?.tasks ?? []).filter(t => (!owner || (t.owner ?? '') === owner)
    && (!q || `${t.code} ${t.title} ${t.owner ?? ''}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <>
      <PageHeader title="Task board" sub="Only approved tasks appear here. Each one links back to the words that created or changed it." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40" />)}</div>
        : !data?.tasks.length ? (
          <Empty icon={<KanbanSquare size={22} />} action={<Link to="/review" className="text-[14px] font-medium text-sky hover:underline">Go to Review changes</Link>}>
            No approved tasks yet. Tasks appear here after you approve a meeting’s proposed changes.
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-[280px]">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input aria-label="Filter tasks" className={`${inputCls} h-8 pl-8`} placeholder="Filter by code, title or owner" value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <select aria-label="Owner" className={`${inputCls} h-8 max-w-[200px]`} value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="">All owners</option>{owners.map(o => <option key={o} value={o}>{o || 'Unassigned'}</option>)}
              </select>
              {(q || owner) && <Button kind="ghost" size="sm" onClick={() => { setQ(''); setOwner('') }}>Clear</Button>}
              <span className="ml-auto text-[12.5px] text-faint">{tasks.length} of {data.tasks.length} tasks</span>
            </div>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              {COLUMNS.map(col => {
                const items = tasks.filter(t => (col === 'blocked' ? t.status === 'blocked' || (t.is_blocked && t.status === 'todo') : t.status === col && !(col === 'todo' && t.is_blocked)))
                const isOpen = !['done', 'cancelled'].includes(col)
                return (
                  <section key={col} aria-label={taskLabel(col)} className="min-w-0 rounded-xl bg-panel-2/60 p-2">
                    <h2 className="mb-2 flex items-center justify-between px-1.5 pt-1 text-[13px] font-semibold text-slate">{taskLabel(col)}<span className="tnum font-normal text-faint">{items.length}</span></h2>
                    {!items.length ? <p className="px-1.5 pb-2 text-[12.5px] text-faint">None</p> : (
                      <ul className="space-y-2">
                        {items.map(t => (
                          <li key={t.code}>
                            <button onClick={() => setOpen(t.code)} className="w-full rounded-lg border border-rule bg-panel p-3 text-left shadow-soft transition-colors hover:border-rule-strong focus-visible:border-sky">
                              <div className="flex items-center justify-between gap-2 text-[12px] text-faint"><span className="tnum font-medium">{t.code}</span>{t.revision > 1 && <span>revised {t.revision - 1}×</span>}</div>
                              <div className="mt-0.5 font-medium leading-snug text-ink">{t.title}</div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-slate"><Avatar name={t.owner} size={18} /><span className="truncate">{t.owner ?? 'Unassigned'}</span></span>
                                <DueChip due={t.due_date} open={isOpen} />
                                <Priority p={t.priority} />
                              </div>
                              {t.prerequisites.some(p => p.status !== 'done') && (
                                <div className="mt-2 flex flex-wrap gap-1">{t.prerequisites.filter(p => p.status !== 'done').map(p => <Chip key={p.code} tone="cancel" icon={<Link2 size={11} />}>waits for {p.code}</Chip>)}</div>
                              )}
                              <div className="mt-2 truncate text-[12px] text-faint">From {data.meetings.get(t.origin_meeting_id)?.title ?? `meeting ${t.origin_meeting_id}`}</div>
                            </button>
                          </li>))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          </>
        )}
      {open && data && <TaskDrawer code={open} onClose={() => setOpen(null)} onChanged={reload} meetings={data.meetings} />}
    </>
  )
}
