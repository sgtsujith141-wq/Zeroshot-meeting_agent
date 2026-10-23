import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, download, fmtDate, fmtDateTime } from '../lib/api'
import type { Reminder, Task } from '../types'
import { Button, Dialog, Empty, ErrorBox, Field, Loading, PageHeader, Section, Status, Tabs, errText, inputCls, plural, useLoad, useToast } from '../components/ui'
import { reminderStatus, taskLabel } from '../lib/status'

type Tab = 'agenda' | 'calendar' | 'reminders' | 'notifications'
interface Row { code: string; title: string; owner: string | null; status: string; due_date: string | null; meeting_id: number; meeting_title: string; waiting_for?: string[] }
interface Agenda {
  as_of: string; timezone: string; markdown: string
  sections: { overdue: Row[]; blocked: Row[]; due_within_7_days: Row[]; open_without_due_date: Row[]; other_open: Row[]
    open_questions: { id: number; text: string; meeting_id: number; meeting_title: string }[]
    pending_reviews: { change_set_id: number; meeting_id: number; meeting_title: string; state: string; unanswered_questions: string[] }[] }
}
interface CalEvent { id: number; task_code: string; title: string; date: string; timezone: string; sync_state: string; owner: string | null; task_status: string }
interface Note { id: number; message: string; read: boolean; created_at: string }
interface Health { clock: string; reminder_worker: { running: boolean; last_run_utc: string | null; interval_seconds: number } }

export default function FollowUpsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (['agenda', 'calendar', 'reminders', 'notifications'].includes(params.get('tab') ?? '') ? params.get('tab') : 'agenda') as Tab
  const notes = useLoad(() => api.get<Note[]>('/api/notifications'), [], 15000)
  const unread = notes.data?.filter(n => !n.read).length ?? 0
  return (
    <>
      <PageHeader title="Follow-ups" sub="What to raise next time, when approved work is due, and the reminders that go with it. Only approved tasks appear here." />
      <Tabs label="Follow-ups" value={tab} onChange={k => setParams(k === 'agenda' ? {} : { tab: k }, { replace: true })} tabs={[
        { key: 'agenda', label: 'Agenda' }, { key: 'calendar', label: 'Calendar' }, { key: 'reminders', label: 'Reminders' },
        { key: 'notifications', label: <>Notifications{unread > 0 && <span className="ml-1.5 text-faint tnum">{unread}</span>}</> },
      ]} />
      {tab === 'agenda' && <AgendaTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'reminders' && <RemindersTab />}
      {tab === 'notifications' && <NotificationsTab notes={notes} />}
    </>
  )
}

function TaskRows({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">{rows.map(r => (
      <li key={r.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
        <Link to={`/tasks?task=${r.code}`} className="min-w-0 flex-1 text-ink hover:underline"><span className="tnum mr-2 text-[13px] text-faint">{r.code}</span>{r.title}</Link>
        <span className="text-[13.5px] text-slate">{r.owner ?? 'Unassigned'}, due {fmtDate(r.due_date)}{r.waiting_for?.length ? `, waiting for ${r.waiting_for.join(', ')}` : ''}</span>
        <Link to={`/meetings/${r.meeting_id}`} className="text-[13px] text-sky hover:underline">from {r.meeting_title}</Link>
      </li>))}
    </ul>
  )
}

function AgendaTab() {
  const { data, error, loading, reload } = useLoad(() => api.get<Agenda>('/api/agenda'))
  if (loading && !data) return <Loading />
  const s = data?.sections
  const groups: [keyof Agenda['sections'], string][] = [['overdue', 'Overdue'], ['blocked', 'Blocked'], ['due_within_7_days', 'Due within 7 days'], ['open_without_due_date', 'Open, no due date'], ['other_open', 'Other open tasks']]
  const empty = s && groups.every(([k]) => !(s[k] as Row[]).length) && !s.open_questions.length && !s.pending_reviews.length
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13.5px] text-slate">Next meeting agenda, built from the task board, open questions and pending approvals as of {fmtDate(data.as_of)} ({data.timezone}).</p>
          <Button onClick={() => download('/api/agenda.md', `agenda-${data.as_of}.md`)}>Download as Markdown</Button>
        </div>
      )}
      {empty && <Empty>Nothing to raise. Open approved tasks, unresolved questions and pending approvals appear here.</Empty>}
      {s && (
        <div className="space-y-7">
          {groups.map(([k, label]) => (s[k] as Row[]).length > 0 && <Section key={k} title={label} count={(s[k] as Row[]).length}><TaskRows rows={s[k] as Row[]} /></Section>)}
          {s.open_questions.length > 0 && (
            <Section title="Unresolved questions" count={s.open_questions.length}>
              <ul className="divide-y divide-rule border-y border-rule">{s.open_questions.map(q => (
                <li key={q.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span className="text-ink">{q.text}</span><Link to={`/meetings/${q.meeting_id}`} className="text-[13px] text-sky hover:underline">from {q.meeting_title}</Link></li>))}
              </ul>
            </Section>
          )}
          {s.pending_reviews.length > 0 && (
            <Section title="Approvals not yet done" count={s.pending_reviews.length}>
              <ul className="divide-y divide-rule border-y border-rule">{s.pending_reviews.map(p => (
                <li key={p.change_set_id} className="py-2"><Link to={`/approvals/${p.meeting_id}`} className="font-medium text-sky hover:underline">{p.meeting_title}</Link>
                  {p.unanswered_questions.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px] text-slate">{p.unanswered_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
                </li>))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  )
}

function CalendarTab() {
  const toast = useToast()
  const { data, error, loading, reload } = useLoad(() => api.get<CalEvent[]>('/api/calendar'))
  if (loading && !data) return <Loading />
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-slate">Due dates of approved tasks. The calendar is exported as an .ics file; no external calendar is changed.</p>
        <Button onClick={() => download('/api/calendar.ics', 'ps53-tasks.ics').catch(e => toast('error', errText(e)))} disabled={!data?.length}>Export calendar (.ics)</Button>
      </div>
      {!data?.length ? <Empty>Approved tasks with a due date appear here.</Empty> : (
        <table className="w-full text-left text-[14px]">
          <thead className="text-[12.5px] text-faint"><tr className="border-b border-rule"><th className="py-2 pr-4 font-medium">Date</th><th className="py-2 pr-4 font-medium">Task</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Owner</th><th className="hidden py-2 font-medium md:table-cell">Entry</th></tr></thead>
          <tbody>{data.map(e => (
            <tr key={e.id} className="border-b border-rule">
              <td className="tnum py-2 pr-4 text-ink">{fmtDate(e.date)}</td>
              <td className="py-2 pr-4"><Link to={`/tasks?task=${e.task_code}`} className="text-ink hover:underline"><span className="tnum mr-2 text-[13px] text-faint">{e.task_code}</span>{e.title.replace(`${e.task_code} due: `, '')}</Link></td>
              <td className="hidden py-2 pr-4 text-slate sm:table-cell">{e.owner ?? 'Unassigned'}</td>
              <td className="hidden py-2 text-[13.5px] text-slate md:table-cell">All day, {e.timezone}, {e.sync_state === 'local' ? 'in the app' : 'exported'}</td>
            </tr>))}
          </tbody>
        </table>
      )}
    </>
  )
}

function RemindersTab() {
  const toast = useToast()
  const { data, error, loading, reload } = useLoad(async () => {
    const [reminders, tasks, health] = await Promise.all([api.get<Reminder[]>('/api/reminders'), api.get<Task[]>('/api/tasks'), api.get<Health>('/api/health')])
    return { reminders, tasks, health }
  }, [], 15000)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ task_code: '', at: '', channel: 'in_app', recipients: '' })
  const [formErr, setFormErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [ran, setRan] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy('create'); setFormErr(null)
    try {
      await api.post('/api/reminders', { task_code: form.task_code, scheduled_at: form.at, channel: form.channel, recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean) })
      setOpen(false); setForm({ task_code: '', at: '', channel: 'in_app', recipients: '' }); await reload()
      toast('ok', 'Reminder drafted. It does nothing until you approve it.')
    } catch (x) { setFormErr(errText(x)) } finally { setBusy(null) }
  }
  async function act(id: number, what: 'approve' | 'cancel') {
    setBusy(`${what}-${id}`)
    try { await api.post(`/api/reminders/${id}/${what}`); await reload(); toast('ok', what === 'approve' ? 'Reminder approved and scheduled.' : 'Reminder cancelled.') }
    catch (x) { toast('error', errText(x)) } finally { setBusy(null) }
  }
  async function runDue() {
    setBusy('run')
    try {
      const r = await api.post<{ delivered_reminder_ids: number[]; clock: string }>('/api/reminders/run-due')
      setRan(`${plural(r.delivered_reminder_ids.length, 'reminder')} delivered in the app just now (${r.clock} clock). Email reminders are only sent when the server has SMTP configured; check each row's status.`)
      await reload()
    } catch (x) { toast('error', errText(x)) } finally { setBusy(null) }
  }
  if (loading && !data) return <Loading />
  const w = data?.health.reminder_worker
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-[70ch] text-[13.5px] text-slate">
            The reminder worker is {w?.running ? `running and checks every ${w.interval_seconds} s` : 'not running'}; last check {fmtDateTime(w?.last_run_utc)}. Reminders only fire while the server runs. A drafted reminder does nothing until you approve it.
          </p>
          <div className="flex gap-2">
            <Button loading={busy === 'run'} onClick={runDue}>Deliver due reminders now</Button>
            <Button kind="primary" onClick={() => setOpen(true)}>New reminder</Button>
          </div>
        </div>
      )}
      {ran && <p role="status" className="mb-3 text-[13.5px] text-ink">{ran}</p>}
      {!data?.reminders.length ? <Empty>No reminders yet. Approving a task with a due date schedules one automatically.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12.5px] text-faint"><tr className="border-b border-rule"><th className="py-2 pr-4 font-medium">Task</th><th className="py-2 pr-4 font-medium">When</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Channel</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2" /></tr></thead>
            <tbody>{data.reminders.map(r => {
              const s = reminderStatus(r.delivery_state)
              return (
                <tr key={r.id} className="border-b border-rule align-top">
                  <td className="whitespace-nowrap py-2 pr-4"><Link to={`/tasks?task=${r.task_code}`} className="tnum text-ink hover:underline">{r.task_code}</Link></td>
                  <td className="tnum py-2 pr-4 text-slate">{fmtDateTime(r.scheduled_at_local ?? r.scheduled_at)}</td>
                  <td className="hidden py-2 pr-4 text-slate sm:table-cell">{r.channel === 'in_app' ? 'In the app' : `Email to ${r.recipients.join(', ')}`}</td>
                  <td className="py-2 pr-4"><Status tone={s.tone}>{s.label}</Status>{r.last_error && <div className="text-[12.5px] text-slate">{r.last_error}</div>}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {r.delivery_state === 'draft' && <Button size="sm" kind="primary" loading={busy === `approve-${r.id}`} onClick={() => act(r.id, 'approve')}>Approve</Button>}{' '}
                    {['draft', 'scheduled'].includes(r.delivery_state) && <Button size="sm" kind="ghost" loading={busy === `cancel-${r.id}`} onClick={() => act(r.id, 'cancel')}>Cancel</Button>}
                  </td>
                </tr>)
            })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New reminder" width={480}>
        <form onSubmit={create} className="space-y-3">
          {formErr && <p role="alert" className="text-[13.5px] text-cancel">{formErr}</p>}
          <Field label="Task"><select className={inputCls} required value={form.task_code} onChange={e => setForm({ ...form, task_code: e.target.value })}>
            <option value="">Choose a task</option>{data?.tasks.filter(t => !['done', 'cancelled'].includes(t.status)).map(t => <option key={t.code} value={t.code}>{t.code} {t.title} ({taskLabel(t.status)})</option>)}</select></Field>
          <Field label="When" hint="In the task's time zone."><input type="datetime-local" required className={inputCls} value={form.at} onChange={e => setForm({ ...form, at: e.target.value })} /></Field>
          <Field label="Channel"><select className={inputCls} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}><option value="in_app">In the app</option><option value="email">Email</option></select></Field>
          {form.channel === 'email' && <Field label="Recipients" hint="Comma-separated. Email is only sent if the server has SMTP configured."><input className={inputCls} value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value })} placeholder="a@example.com, b@example.com" /></Field>}
          <div className="flex justify-end gap-2 pt-1"><Button onClick={() => setOpen(false)}>Cancel</Button><Button kind="primary" type="submit" loading={busy === 'create'}>Draft reminder</Button></div>
        </form>
      </Dialog>
    </>
  )
}

function NotificationsTab({ notes }: { notes: ReturnType<typeof useLoad<Note[]>> }) {
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  async function read(id: number) {
    setBusy(id)
    try { await api.post(`/api/notifications/${id}/read`); await notes.reload() } catch (e) { toast('error', errText(e)) } finally { setBusy(null) }
  }
  if (notes.loading && !notes.data) return <Loading />
  return (
    <>
      <ErrorBox error={notes.error} onRetry={notes.reload} />
      {!notes.data?.length ? <Empty>No reminder has fired yet. In-app reminders appear here when they are delivered.</Empty> : (
        <ul className="divide-y divide-rule border-y border-rule">{notes.data.map(n => (
          <li key={n.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className={`min-w-0 flex-1 ${n.read ? 'text-slate' : 'font-medium text-ink'}`}>{n.message}</span>
            <span className="tnum text-[12.5px] text-faint">{fmtDateTime(n.created_at)}</span>
            {n.read ? <span className="text-[12.5px] text-faint">Read</span> : <Button size="sm" kind="ghost" loading={busy === n.id} onClick={() => read(n.id)}>Mark read</Button>}
          </li>))}
        </ul>
      )}
    </>
  )
}
