import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, download, fmtDate, fmtDateTime, fmtTime } from '../lib/api'
import type { MeetingSummary, Task, TaskDetail } from '../types'
import { Button, Drawer, Empty, ErrorBox, Loading, Notice, PageHeader, Skeleton, Status, Tabs, errText, inputCls, useLoad, useToast } from '../components/ui'
import { OPEN_TASK, reminderStatus, shortDate, taskLabel, taskTone, todayIso } from '../lib/status'

const COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const
const NEEDS_PREREQS = ['in_progress', 'done']

function Due({ t }: { t: Task }) {
  if (!t.due_date) return <span className="text-faint">—</span>
  const open = OPEN_TASK.includes(t.status), today = todayIso()
  if (open && t.due_date < today) return <span className="text-cancel">Overdue, {shortDate(t.due_date)}</span>
  if (open && t.due_date === today) return <span className="text-ask">Today</span>
  return <span className="tnum text-slate">{shortDate(t.due_date)}</span>
}
function Deps({ t }: { t: Task }) {
  const waiting = t.prerequisites.filter(p => p.status !== 'done')
  if (waiting.length) return <span className="text-cancel">Waiting for {waiting.map(p => p.code).join(', ')}</span>
  if (t.prerequisites.length) return <span className="text-slate">After {t.prerequisites.map(p => p.code).join(', ')} (done)</span>
  if (t.dependents.length) return <span className="text-slate">Blocks {t.dependents.map(p => p.code).join(', ')}</span>
  return <span className="text-faint">—</span>
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams()
  const { data, error, loading, reload } = useLoad(async () => {
    const [tasks, meetings] = await Promise.all([api.get<Task[]>('/api/tasks'), api.get<MeetingSummary[]>('/api/meetings')])
    return { tasks, meetings: new Map(meetings.map(m => [m.id, m])) }
  })
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState('open')
  const view = params.get('view') === 'board' ? 'board' : 'list'
  const openCode = params.get('task')
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const owners = useMemo(() => [...new Set((data?.tasks ?? []).map(t => t.owner ?? ''))].sort(), [data])
  const tasks = (data?.tasks ?? []).filter(t => (!owner || (t.owner ?? '') === owner)
    && (view === 'board' || status === 'all' || (status === 'open' ? OPEN_TASK.includes(t.status) : t.status === status))
    && (!q || `${t.code} ${t.title} ${t.owner ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const meeting = (id: number) => data?.meetings.get(id)?.title ?? `Meeting ${id}`

  return (
    <>
      <PageHeader title="Tasks" sub="Approved tasks from your meetings. Each one links back to the words that created or changed it." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.tasks.length ? (
        <Empty action={<Link to="/approvals" className="font-medium text-sky hover:underline">Go to Approvals</Link>}>No approved tasks yet. Tasks appear here after you approve a meeting’s proposed changes.</Empty>
      ) : (
        <>
          <Tabs label="View" value={view} onChange={v => setParam('view', v === 'board' ? 'board' : null)} tabs={[{ key: 'list', label: 'List' }, { key: 'board', label: 'Board' }]} />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input aria-label="Search tasks" className={`${inputCls} max-w-[260px]`} placeholder="Search code, title or owner" value={q} onChange={e => setQ(e.target.value)} />
            <select aria-label="Owner" className={`${inputCls} max-w-[180px]`} value={owner} onChange={e => setOwner(e.target.value)}>
              <option value="">All owners</option>{owners.map(o => <option key={o} value={o}>{o || 'Unassigned'}</option>)}
            </select>
            {view === 'list' && (
              <select aria-label="Status" className={`${inputCls} max-w-[160px]`} value={status} onChange={e => setStatus(e.target.value)}>
                <option value="open">Open</option><option value="all">All statuses</option>{COLUMNS.map(c => <option key={c} value={c}>{taskLabel(c)}</option>)}
              </select>
            )}
            {(q || owner || (view === 'list' && status !== 'open')) && <Button kind="ghost" size="sm" onClick={() => { setQ(''); setOwner(''); setStatus('open') }}>Clear</Button>}
            <span className="ml-auto text-[13px] text-faint">{tasks.length} of {data.tasks.length} tasks</span>
          </div>

          {view === 'list' ? (!tasks.length ? <Empty>No task matches.</Empty> : (
            <div className="overflow-x-auto rounded-lg border border-rule bg-panel">
              <table className="w-full text-left text-[14px]">
                <thead className="text-[12.5px] text-faint">
                  <tr className="border-b border-rule">
                    <th className="py-2 pl-4 pr-4 font-medium">Task</th><th className="py-2 pr-4 font-medium">Assigned to</th><th className="py-2 pr-4 font-medium">Deadline</th>
                    <th className="py-2 pr-4 font-medium">Status</th><th className="hidden py-2 pr-4 font-medium md:table-cell">Dependency</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.code} className="cursor-pointer border-b border-rule last:border-b-0 hover:bg-panel-2" onClick={() => setParam('task', t.code)}>
                      <td className="py-3 pl-4 pr-4">
                        <button type="button" className="text-left font-medium text-ink hover:underline" onClick={e => { e.stopPropagation(); setParam('task', t.code) }}>
                          <span className="tnum mr-2 text-[13px] font-normal text-faint">{t.code}</span>{t.title}
                        </button>
                        {/* On phones the Dependency column is hidden; a waiting task still says so. */}
                        {t.prerequisites.some(p => p.status !== 'done') && <div className="text-[12.5px] md:hidden"><Deps t={t} /></div>}
                      </td>
                      <td className="py-3 pr-4 text-ink">{t.owner ?? <span className="text-faint">Unassigned</span>}</td>
                      <td className="whitespace-nowrap py-3 pr-4"><Due t={t} /></td>
                      <td className="py-3 pr-4"><Status tone={taskTone(t.status)}>{taskLabel(t.status)}</Status></td>
                      <td className="hidden py-3 pr-4 text-[13.5px] md:table-cell"><Deps t={t} /></td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          )) : (
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              {COLUMNS.map(col => {
                const items = tasks.filter(t => t.status === col)
                return (
                  <section key={col} aria-label={taskLabel(col)} className="min-w-0">
                    <h2 className="mb-1 flex items-baseline justify-between border-b border-rule pb-1.5 text-[13.5px] font-semibold text-slate">{taskLabel(col)}<span className="tnum font-normal text-faint">{items.length}</span></h2>
                    {!items.length ? <p className="py-2 text-[13px] text-faint">None</p> : (
                      <ul className="divide-y divide-rule">{items.map(t => (
                        <li key={t.code}>
                          <button type="button" onClick={() => setParam('task', t.code)} className="w-full px-1 py-2 text-left hover:bg-panel-2">
                            <span className="tnum text-[12.5px] text-faint">{t.code}</span>
                            <span className="block leading-snug text-ink">{t.title}</span>
                            <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12.5px] text-slate"><span>{t.owner ?? 'Unassigned'}</span><Due t={t} /></span>
                            {t.prerequisites.some(p => p.status !== 'done') && <span className="block text-[12.5px]"><Deps t={t} /></span>}
                          </button>
                        </li>))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
      {openCode && data && <TaskDrawer code={openCode} onClose={() => setParam('task', null)} onChanged={reload} meeting={meeting} />}
    </>
  )
}

function TaskDrawer({ code, onClose, onChanged, meeting }: { code: string; onClose: () => void; onChanged: () => void; meeting: (id: number) => string }) {
  const toast = useToast()
  const { data: t, error, reload } = useLoad(() => api.get<TaskDetail>(`/api/tasks/${code}`), [code])
  const [busy, setBusy] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  async function move(status: string) {
    if (!t) return
    setBusy(status); setConflict(null)
    try {
      await api.patch(`/api/tasks/${code}`, { expected_revision: t.revision, status })
      toast('ok', `${code} moved to ${taskLabel(status)}.`)
      await reload(); onChanged()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /revision/.test(e.message)) {
        // Someone else changed the task: show what it is now, not what this drawer last saw.
        const fresh = await reload(); onChanged()
        setConflict(`${code} was changed elsewhere and is now ${fresh ? taskLabel(fresh.status) : 'different'} (revision ${fresh?.revision ?? '?'}). Nothing was changed by this click. Check it and try again if you still want to move it.`)
      } else toast('error', errText(e))
    } finally { setBusy(null) }
  }
  const waiting = t?.prerequisites.filter(p => p.status !== 'done') ?? []
  return (
    <Drawer open onClose={onClose} title={t?.title ?? code} sub={code}>
      <ErrorBox error={error} onRetry={reload} />
      {!t ? <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-24" /></div> : (
        <div className="space-y-6 text-[14px]">
          {conflict && <Notice tone="ask" role="alert" title="This task changed">{conflict}</Notice>}
          <section>
            <div className="mb-2 flex items-center gap-3"><Status tone={taskTone(t.status)}>{taskLabel(t.status)}</Status>{t.is_blocked && t.status !== 'blocked' && <span className="text-[13px] text-cancel">Waiting for prerequisites</span>}</div>
            <h3 className="mb-1.5 text-[13px] font-semibold text-slate">Move to</h3>
            <div className="flex flex-wrap gap-2">{t.allowed_transitions.map(s => {
              const blocked = NEEDS_PREREQS.includes(s) && waiting.length > 0
              return <Button key={s} size="sm" loading={busy === s} disabled={!!busy || blocked} title={blocked ? `Waiting for ${waiting.map(p => p.code).join(', ')}` : undefined} onClick={() => move(s)}>{taskLabel(s)}</Button>
            })}</div>
            <p className="mt-1.5 text-[12.5px] text-faint">{waiting.length ? `Starting or finishing is disabled until ${waiting.map(p => p.code).join(', ')} is done. The server enforces this too.` : 'Starting or finishing requires every prerequisite to be done.'}</p>
          </section>

          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-faint">Assigned to</dt><dd>{t.owner ?? 'Unassigned'} <span className="text-[12.5px] text-faint">{t.owner_certainty.replace(/_/g, ' ')}</span></dd>
            <dt className="text-faint">Deadline</dt><dd>{fmtDate(t.due_date)} {t.deadline_raw && <span className="block text-[12.5px] text-faint">Said “{t.deadline_raw}”, {t.deadline_kind?.replace(/_/g, ' ')}</span>}</dd>
            <dt className="text-faint">Priority</dt><dd>{t.priority ? <span className="capitalize">{t.priority}</span> : 'Not set'} {t.priority_basis && <span className="block text-[12.5px] text-faint">{t.priority_basis}</span>}</dd>
            <dt className="text-faint">Waits for</dt><dd>{t.prerequisites.length ? t.prerequisites.map(p => <span key={p.code} className="mr-3 inline-block">{p.code} <span className="text-faint">{taskLabel(p.status)}</span></span>) : 'Nothing'}</dd>
            {t.dependents.length > 0 && <><dt className="text-faint">Blocks</dt><dd>{t.dependents.map(p => p.code).join(', ')}</dd></>}
            <dt className="text-faint">Origin</dt><dd><Link className="text-sky hover:underline" to={`/meetings/${t.origin_meeting_id}`}>{meeting(t.origin_meeting_id)}</Link></dd>
            <dt className="text-faint">Calendar</dt><dd>{t.calendar_event ? (
              <span className="flex flex-wrap items-center gap-2">{fmtDate(t.calendar_event.date)} <span className="text-[12.5px] text-faint">{t.calendar_event.sync_state === 'local' ? 'in the app only' : 'exported as .ics'}</span>
                <Button size="sm" onClick={() => download(`/api/tasks/${code}/event.ics`, `${code}.ics`).catch(e => toast('error', errText(e)))}>Download .ics</Button></span>) : 'No due date'}</dd>
          </dl>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate">Where this came from</h3>
            <ul className="space-y-3">{t.evidence_detail.map((e, i) => (
              <li key={i} className="border-l-2 border-rule-strong pl-3">
                {e.exists ? <p className="spoken text-ink">“{e.text}”</p> : <p className="text-cancel">Segment no longer exists</p>}
                <Link to={`/meetings/${e.meeting_id}#${e.seg_key}`} className="text-[12.5px] text-sky hover:underline">{e.meeting_title}, {e.speaker_label} at <span className="tnum">{fmtTime(e.start_seconds)}</span> ({e.seg_key})</Link>
              </li>))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate">Approved history</h3>
            <ol className="space-y-2.5 border-l border-rule pl-3">{t.revisions.map(r => (
              <li key={r.revision} className="text-[13.5px]">
                <div className="text-ink">Revision {r.revision} <span className="text-faint">{fmtDateTime(r.created_at)}</span></div>
                <div className="text-slate">{r.reason}, by {r.actor}. Owner {String(r.snapshot.owner ?? 'unassigned')}, due {String(r.snapshot.due_date ?? 'none')}, {taskLabel(String(r.snapshot.status))}.</div>
              </li>))}
            </ol>
          </section>

          {t.reminders.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-slate">Reminders</h3>
              <ul className="space-y-1 text-[13.5px]">{t.reminders.map(r => { const s = reminderStatus(r.delivery_state); return <li key={r.id} className="flex flex-wrap items-center gap-3"><span className="tnum">{fmtDateTime(r.scheduled_at)}</span><span className="text-faint">{r.channel === 'in_app' ? 'in the app' : 'email'}</span><Status tone={s.tone}>{s.label}</Status></li> })}</ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}
