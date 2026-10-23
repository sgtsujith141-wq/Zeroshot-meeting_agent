import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../lib/api'
import type { MeetingSummary, Task } from '../types'
import { Empty, ErrorBox, Loading, PageHeader, Section, Status, type Tone, plural, useLoad } from '../components/ui'
import { BUSY, OPEN_TASK, meetingStatus, shortDate, todayIso } from '../lib/status'

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number }

function Row({ to, title, detail, status }: { to: string; title: ReactNode; detail?: ReactNode; status?: { label: string; tone: Tone; busy?: boolean } }) {
  return (
    <li>
      <Link to={to} className="flex items-baseline gap-3 px-1 py-2.5 hover:bg-panel-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{title}</span>
          {detail && <span className="block text-[13px] text-slate">{detail}</span>}
        </span>
        {status && <Status tone={status.tone} busy={status.busy}>{status.label}</Status>}
      </Link>
    </li>
  )
}
const List = ({ children, empty }: { children: ReactNode[]; empty: string }) =>
  children.length ? <ul className="divide-y divide-rule border-y border-rule">{children}</ul> : <p className="border-y border-rule px-1 py-2.5 text-[14px] text-faint">{empty}</p>

export default function Overview() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [meetings, changesets, tasks] = await Promise.all([
      api.get<MeetingSummary[]>('/api/meetings'), api.get<CsRow[]>('/api/changesets'), api.get<Task[]>('/api/tasks')])
    return { meetings, changesets, tasks }
  }, [], d => (d?.meetings.some(m => BUSY.includes(m.processing_status)) ? 4000 : undefined))

  const today = todayIso()
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const pending = (data?.changesets ?? []).filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state))
  const attention = (data?.meetings ?? []).filter(m => ['processing', 'failed', 'empty'].includes(meetingStatus(m).key))
  const open = (data?.tasks ?? []).filter(t => OPEN_TASK.includes(t.status))
  const upcoming = open.filter(t => t.due_date && t.due_date <= week).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
  const blocked = open.filter(t => t.is_blocked || t.status === 'blocked')
  const recent = (data?.meetings ?? []).slice(0, 5)

  return (
    <>
      <PageHeader title="Overview" sub="What needs your attention: approvals waiting, meetings that need you, and work that is due or stuck."
        actions={<Link to="/meetings/new" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13.5px] font-medium text-on-accent hover:bg-accent-hover">New meeting</Link>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && !data.meetings.length ? (
        <Empty action={<Link to="/meetings/new" className="font-medium text-sky hover:underline">Add a meeting</Link>}>
          No meetings yet. Upload a consented recording or a transcript; the proposed tasks will wait here for your approval.
        </Empty>
      ) : data && (
        <div className="space-y-8">
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <Section title="Pending approvals" count={pending.length} actions={<Link to="/approvals" className="text-sky hover:underline">All approvals</Link>}>
              <List empty="Nothing is waiting for approval.">{pending.map(c => (
                <Row key={c.id} to={`/approvals/${c.meeting_id}`} title={c.meeting_title}
                  detail={c.open_questions ? `${plural(c.open_questions, 'question')} to answer before approving` : `${plural(c.items, 'proposed item')}, ready to approve`}
                  status={c.open_questions ? { label: 'Needs review', tone: 'ask' } : { label: 'Ready to approve', tone: 'accent' }} />))}
              </List>
            </Section>
            <Section title="Upcoming tasks" count={upcoming.length} actions={<Link to="/tasks" className="text-sky hover:underline">All tasks</Link>}>
              <List empty="Nothing is due in the next 7 days.">{upcoming.map(t => (
                <Row key={t.code} to={`/tasks?task=${t.code}`} title={<><span className="tnum mr-2 text-[13px] text-faint">{t.code}</span>{t.title}</>}
                  detail={t.owner ?? 'Unassigned'}
                  status={t.due_date! < today ? { label: `Overdue, ${shortDate(t.due_date!)}`, tone: 'cancel' } : t.due_date === today ? { label: 'Due today', tone: 'ask' } : { label: `Due ${shortDate(t.due_date!)}`, tone: 'neutral' }} />))}
              </List>
            </Section>
            <Section title="Meetings requiring attention" count={attention.length}>
              <List empty="No meeting is processing, failed or waiting for a file.">{attention.map(m => {
                const st = meetingStatus(m)
                return <Row key={m.id} to={`/meetings/${m.id}`} title={m.title} detail={m.processing_error ?? fmtDate(m.scheduled_at)} status={st} />
              })}</List>
            </Section>
            <Section title="Blocked work" count={blocked.length}>
              <List empty="No open task is waiting on another.">{blocked.map(t => (
                <Row key={t.code} to={`/tasks?task=${t.code}`} title={<><span className="tnum mr-2 text-[13px] text-faint">{t.code}</span>{t.title}</>}
                  detail={`Waiting for ${t.prerequisites.filter(p => p.status !== 'done').map(p => `${p.code} ${p.title}`).join(', ') || t.blocked_reason || 'a prerequisite'}`}
                  status={{ label: 'Blocked', tone: 'cancel' }} />))}
              </List>
            </Section>
          </div>
          <Section title="Recent meetings" actions={<Link to="/meetings" className="text-sky hover:underline">All meetings</Link>}>
            <List empty="No meetings yet.">{recent.map(m => <Row key={m.id} to={`/meetings/${m.id}`} title={m.title} detail={fmtDate(m.scheduled_at)} status={meetingStatus(m)} />)}</List>
          </Section>
        </div>
      )}
    </>
  )
}
