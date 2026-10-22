import { useState, type FormEvent } from 'react'
import { api, ApiError, download, fmtDate, fmtDateTime } from '../lib/api'
import type { Reminder, Task } from '../types'
import { Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, StateChip, inputCls, useLoad } from '../components/ui'

interface CalEvent { id: number; task_code: string; title: string; date: string; timezone: string; sync_state: string; owner: string | null; task_status: string }
interface Note { id: number; message: string; read: boolean; created_at: string }

export default function FollowUpPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [events, reminders, notes, tasks, health] = await Promise.all([
      api.get<CalEvent[]>('/api/calendar'), api.get<Reminder[]>('/api/reminders'), api.get<Note[]>('/api/notifications'),
      api.get<Task[]>('/api/tasks'), api.get<{ clock: string; reminder_worker: { running: boolean; last_run_utc: string | null; interval_seconds: number } }>('/api/health')])
    return { events, reminders, notes, tasks, health }
  }, [], 15000)
  const [form, setForm] = useState({ task_code: '', at: '', channel: 'in_app', recipients: '' })
  const [err, setErr] = useState<string | null>(null)
  const [ran, setRan] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      await api.post('/api/reminders', { task_code: form.task_code, scheduled_at: form.at, channel: form.channel,
        recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean) })
      setErr(null); setForm({ ...form, at: '' }); reload()
    } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)) }
  }
  async function act(path: string) { try { await api.post(path); setErr(null); reload() } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)) } }
  async function runDue() {
    const r = await api.post<{ delivered_reminder_ids: number[]; clock: string }>('/api/reminders/run-due')
    setRan(`${r.delivered_reminder_ids.length} reminder(s) delivered now (${r.clock} clock).`); reload()
  }

  if (loading && !data) return <Loading />
  return (
    <>
      <PageHeader title="Calendar and reminders" sub="Calendar entries and reminders exist only for approved tasks. Calendars are exported as .ics files; no external calendar is changed.">
        <Button onClick={() => download('/api/calendar.ics', 'ps53-tasks.ics')} disabled={!data?.events.length}>Export calendar (.ics)</Button>
      </PageHeader>
      <ErrorBox error={err || error} onRetry={reload} />
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={`Due dates (${data.events.length})`}>
            {!data.events.length ? <Empty>Approved tasks with a due date appear here.</Empty> : (
              <ul className="divide-y divide-rule">{data.events.map(e => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div><div className="font-medium">{fmtDate(e.date)}</div><div className="text-[14px]">{e.title} <span className="text-slate">({e.owner ?? 'unassigned'})</span></div></div>
                  <span className="text-[12.5px] text-slate">all day, {e.timezone}, {e.sync_state === 'local' ? 'in-app' : 'exported'}</span>
                </li>))}
              </ul>
            )}
          </Panel>

          <Panel title="In-app notifications" actions={<Button onClick={runDue}>Deliver due reminders now</Button>}>
            <p className="mb-2 text-[13px] text-slate">
              Reminder worker {data.health.reminder_worker.running ? `running, checks every ${data.health.reminder_worker.interval_seconds} s` : 'not running'}; last check {fmtDateTime(data.health.reminder_worker.last_run_utc)}. Clock: {data.health.clock}. Reminders only fire while the backend is running.
            </p>
            {ran && <p className="mb-2 text-[13.5px] text-create">{ran}</p>}
            {!data.notes.length ? <Empty>No reminders have fired yet.</Empty> : (
              <ul className="space-y-2">{data.notes.map(n => (
                <li key={n.id} className={`rounded-md border p-2.5 text-[14px] ${n.read ? 'border-rule text-slate' : 'border-update/40 bg-update-soft'}`}>
                  <div>{n.message}</div>
                  <div className="mt-1 flex justify-between text-[12.5px] text-slate">{fmtDateTime(n.created_at)}{!n.read && <Button kind="quiet" onClick={() => act(`/api/notifications/${n.id}/read`)}>Mark read</Button>}</div>
                </li>))}
              </ul>
            )}
          </Panel>

          <Panel title={`Reminders (${data.reminders.length})`} className="lg:col-span-2">
            <form onSubmit={create} className="mb-4 grid gap-3 sm:grid-cols-[1.2fr_1fr_0.8fr_1.2fr_auto] sm:items-end">
              <Field label="Task"><select className={inputCls} required value={form.task_code} onChange={e => setForm({ ...form, task_code: e.target.value })}>
                <option value="">Choose…</option>{data.tasks.filter(t => !['done', 'cancelled'].includes(t.status)).map(t => <option key={t.code} value={t.code}>{t.code} {t.title}</option>)}</select></Field>
              <Field label="When (task time zone)"><input type="datetime-local" required className={inputCls} value={form.at} onChange={e => setForm({ ...form, at: e.target.value })} /></Field>
              <Field label="Channel"><select className={inputCls} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}><option value="in_app">In-app</option><option value="email">Email</option></select></Field>
              <Field label="Recipients (email only)"><input className={inputCls} disabled={form.channel !== 'email'} value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value })} placeholder="a@example.com, b@example.com" /></Field>
              <Button type="submit">Draft reminder</Button>
            </form>
            <p className="mb-3 text-[13px] text-slate">A drafted reminder does nothing until you approve it. Email reminders are only sent if the server has SMTP configured.</p>
            {!data.reminders.length ? <Empty>No reminders yet. Approving a task with a due date schedules one automatically, as shown on the review page.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[14px]">
                  <thead className="text-[13px] text-slate"><tr><th className="py-1 font-medium">Task</th><th className="font-medium">Scheduled</th><th className="font-medium">Channel</th><th className="font-medium">State</th><th className="font-medium">Note</th><th /></tr></thead>
                  <tbody>{data.reminders.map(r => (
                    <tr key={r.id} className="border-t border-rule">
                      <td className="py-1.5">{r.task_code}</td><td>{fmtDateTime(r.scheduled_at_local ?? r.scheduled_at)}</td>
                      <td>{r.channel === 'in_app' ? 'In-app' : `Email to ${r.recipients.join(', ')}`}</td>
                      <td><StateChip state={r.delivery_state} /></td><td className="text-[13px] text-slate">{r.last_error}</td>
                      <td className="whitespace-nowrap text-right">
                        {r.delivery_state === 'draft' && <Button kind="primary" onClick={() => act(`/api/reminders/${r.id}/approve`)}>Approve</Button>}
                        {['draft', 'scheduled'].includes(r.delivery_state) && <Button kind="quiet" onClick={() => act(`/api/reminders/${r.id}/cancel`)}>Cancel</Button>}
                      </td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  )
}
