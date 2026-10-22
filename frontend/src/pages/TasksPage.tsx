import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, download, fmtDate, fmtDateTime, fmtTime } from '../lib/api'
import type { Task, TaskDetail } from '../types'
import { Button, Chip, Empty, ErrorBox, Loading, PageHeader, StateChip, stateLabel, useLoad } from '../components/ui'

const COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const
// Task statuses (the shared labels describe proposal states, e.g. 'Cancelled in meeting').
const taskLabel = (s: string) => (s === 'cancelled' ? 'Cancelled' : stateLabel(s))

function TaskDrawer({ code, onClose, onChanged }: { code: string; onClose: () => void; onChanged: () => void }) {
  const { data: t, error, reload } = useLoad(() => api.get<TaskDetail>(`/api/tasks/${code}`), [code])
  const [err, setErr] = useState<string | null>(null)
  async function move(status: string) {
    if (!t) return
    try { await api.patch(`/api/tasks/${code}`, { expected_revision: t.revision, status }); setErr(null); reload(); onChanged() }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)) }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={`Task ${code}`} className="fixed inset-0 z-20 flex justify-end bg-ink/25" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-auto bg-panel p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><div className="text-[13px] text-slate">{code}, revision {t?.revision}</div><h2 className="text-xl font-semibold">{t?.title}</h2></div>
          <Button onClick={onClose} aria-label="Close">Close</Button>
        </div>
        <ErrorBox error={err || error} />
        {t && (
          <div className="space-y-5 text-[14.5px]">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
              <dt className="text-slate">Status</dt><dd><StateChip state={t.status} />{t.is_blocked && t.status !== 'blocked' && <span className="ml-2 text-cancel">waiting for prerequisites</span>}</dd>
              <dt className="text-slate">Owner</dt><dd>{t.owner ?? 'unassigned'} <span className="text-[12.5px] text-slate">({t.owner_certainty.replace(/_/g, ' ')})</span></dd>
              <dt className="text-slate">Due</dt><dd>{fmtDate(t.due_date)} {t.deadline_raw && <span className="text-[12.5px] text-slate">said “{t.deadline_raw}” ({t.deadline_kind})</span>}</dd>
              <dt className="text-slate">Priority</dt><dd>{t.priority ?? 'not set'} {t.priority_basis && <span className="text-[12.5px] text-slate">({t.priority_basis})</span>}</dd>
              <dt className="text-slate">Waits for</dt><dd>{t.prerequisites.length ? t.prerequisites.map(p => `${p.code} (${taskLabel(p.status)})`).join(', ') : 'nothing'}</dd>
              <dt className="text-slate">Calendar</dt><dd>{t.calendar_event ? <>{fmtDate(t.calendar_event.date)}, {t.calendar_event.sync_state === 'local' ? 'in-app only' : 'exported as .ics'} <Button kind="quiet" onClick={() => download(`/api/tasks/${code}/event.ics`, `${code}.ics`)}>Download .ics</Button></> : 'no due date'}</dd>
            </dl>
            <div>
              <h3 className="mb-1 font-semibold">Move to</h3>
              <div className="flex flex-wrap gap-2">{t.allowed_transitions.map(s => <Button key={s} onClick={() => move(s)}>{taskLabel(s)}</Button>)}</div>
              <p className="mt-1 text-[12.5px] text-slate">Starting or finishing requires every prerequisite to be done.</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Where this came from</h3>
              <ul className="space-y-2">{t.evidence_detail.map((e, i) => (
                <li key={i} className="border-l-2 border-rule pl-3">
                  {e.exists ? <p className="spoken">“{e.text}”</p> : <p className="text-cancel">Segment no longer exists</p>}
                  <Link to={`/meetings/${e.meeting_id}#${e.seg_key}`} className="text-[12.5px] text-update hover:underline">{e.meeting_title}, {e.speaker_label} at {fmtTime(e.start_seconds)} ({e.seg_key})</Link>
                </li>))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Approved history</h3>
              <ol className="space-y-1.5">{t.revisions.map(r => (
                <li key={r.revision} className="text-[13.5px]"><span className="font-medium">Revision {r.revision}</span>: {r.reason}, by {r.actor}, {fmtDateTime(r.created_at)}. Owner {String(r.snapshot.owner ?? 'unassigned')}, due {String(r.snapshot.due_date ?? 'none')}, {stateLabel(String(r.snapshot.status))}.</li>))}
              </ol>
            </div>
            {t.reminders.length > 0 && (
              <div><h3 className="mb-1 font-semibold">Reminders</h3>
                <ul className="text-[13.5px]">{t.reminders.map(r => <li key={r.id}>{fmtDateTime(r.scheduled_at)} {r.channel.replace('_', '-')}: <StateChip state={r.delivery_state} /></li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TasksPage() {
  const { data, error, loading, reload } = useLoad(() => api.get<Task[]>('/api/tasks'))
  const [open, setOpen] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <PageHeader title="Task board" sub="Only approved tasks appear here. Each one links back to the words that created or changed it." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No approved tasks yet. Approve a meeting’s proposed changes on the <Link className="text-update underline" to="/review">review page</Link>.</Empty> : (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map(col => {
            const items = data.filter(t => (col === 'blocked' ? t.status === 'blocked' || (t.is_blocked && t.status === 'todo') : t.status === col && !(col === 'todo' && t.is_blocked)))
            return (
              <section key={col} aria-label={taskLabel(col)}>
                <h2 className="mb-2 flex items-center justify-between text-[14px] font-semibold">{taskLabel(col)}<span className="font-normal text-slate">{items.length}</span></h2>
                <ul className="space-y-2">
                  {items.map(t => (
                    <li key={t.code}>
                      <button onClick={() => setOpen(t.code)} className="w-full rounded-[8px] border border-rule bg-panel p-3 text-left hover:border-slate/60">
                        <div className="text-[12.5px] text-slate">{t.code}{t.revision > 1 && `, revised ${t.revision - 1}×`}</div>
                        <div className="font-medium leading-snug">{t.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[12.5px]">
                          <span>{t.owner ?? <span className="text-ask">unassigned</span>}</span>
                          {t.due_date && <Chip tone={t.due_date < today && ['todo', 'in_progress', 'blocked'].includes(t.status) ? 'cancel' : 'neutral'}>{fmtDate(t.due_date)}</Chip>}
                          {t.prerequisites.filter(p => p.status !== 'done').map(p => <Chip key={p.code} tone="cancel">waits for {p.code}</Chip>)}
                        </div>
                      </button>
                    </li>))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      {open && <TaskDrawer code={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}
