import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Mic } from 'lucide-react'
import { api, fmtDate } from '../lib/api'
import type { MeetingSummary, Task } from '../types'
import { Empty, ErrorBox, ListBox, Loading, Section, Status, SyntheticTag, type Tone, plural, useLoad } from '../components/ui'
import { BUSY, OPEN_TASK, isSynthetic, meetingStatus, shortDate, todayIso } from '../lib/status'

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number }

function Row({ to, title, detail, status, aside }: { to: string; title: ReactNode; detail?: ReactNode; status?: { label: string; tone: Tone; busy?: boolean }; aside?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-4 px-4 py-3 hover:bg-panel-2">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-medium text-ink">{title}</span>
          {detail && <span className="mt-0.5 block text-[13px] text-slate">{detail}</span>}
        </span>
        {aside && <span className="hidden shrink-0 text-[13px] text-slate sm:block">{aside}</span>}
        {status && <span className="shrink-0"><Status tone={status.tone} busy={status.busy}>{status.label}</Status></span>}
        <ChevronRight size={15} aria-hidden className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  )
}

const MeetingName = ({ m }: { m: { title: string; file_name?: string | null } }) =>
  <><span className="min-w-0">{m.title}</span>{isSynthetic(m) && <SyntheticTag />}</>

function dueStatus(t: Task, today: string): { label: string; tone: Tone } {
  if (t.is_blocked || t.status === 'blocked') return { label: 'Blocked', tone: 'cancel' }
  if (!t.due_date) return { label: 'No deadline', tone: 'neutral' }
  if (t.due_date < today) return { label: `Overdue, ${shortDate(t.due_date)}`, tone: 'cancel' }
  if (t.due_date === today) return { label: 'Due today', tone: 'ask' }
  return { label: `Due ${shortDate(t.due_date)}`, tone: 'neutral' }
}

export default function Overview() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [meetings, changesets, tasks] = await Promise.all([
      api.get<MeetingSummary[]>('/api/meetings'), api.get<CsRow[]>('/api/changesets'), api.get<Task[]>('/api/tasks')])
    return { meetings, changesets, tasks }
  }, [], d => (d?.meetings.some(m => BUSY.includes(m.processing_status)) ? 4000 : undefined))

  const today = todayIso()
  const byId = new Map((data?.meetings ?? []).map(m => [m.id, m]))
  const pending = (data?.changesets ?? []).filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state))
  const stuck = (data?.meetings ?? []).filter(m => ['failed', 'empty', 'transcribed'].includes(meetingStatus(m).key))
  // Open work, soonest first; undated tasks last. Blocked tasks say what they wait for.
  const upcoming = (data?.tasks ?? []).filter(t => OPEN_TASK.includes(t.status))
    .sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : (a.due_date ?? '9999') > (b.due_date ?? '9999') ? 1 : a.id - b.id)
  const recent = (data?.meetings ?? []).slice(0, 5)
  const newBtn = (
    <Link to="/meetings/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-on-accent hover:bg-accent-hover">
      <Mic size={16} aria-hidden />Record or upload a meeting
    </Link>
  )

  return (
    <>
      <header className="mb-9 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div>
          <h1 className="display text-[42px] leading-[1.05] text-ink">Meeting Actions</h1>
          <p className="mt-2 text-[15px] text-slate">From meetings to work that gets done.</p>
        </div>
        {newBtn}
      </header>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && !data.meetings.length ? (
        <Empty action={newBtn}>
          No meetings yet. Add a consented recording or a transcript; the tasks it proposes wait for your approval before anything changes.
        </Empty>
      ) : data && (
        <div className="space-y-9">
          <Section title="Meetings awaiting review" count={pending.length + stuck.length} actions={<Link to="/approvals" className="text-sky hover:underline">All approvals</Link>}>
            <ListBox empty="Nothing needs you right now. New meetings appear here once their tasks are ready to check.">{[
              ...pending.map(c => {
                const m = byId.get(c.meeting_id)
                return <Row key={`c${c.id}`} to={`/approvals/${c.meeting_id}`} title={<MeetingName m={m ?? { title: c.meeting_title }} />}
                  detail={c.open_questions ? `${plural(c.open_questions, 'question')} to answer, then approve ${plural(c.items, 'proposed change')}` : `${plural(c.items, 'proposed change')} ready to approve`}
                  aside={m && fmtDate(m.scheduled_at)}
                  status={c.open_questions ? { label: 'Needs answers', tone: 'ask' } : { label: 'Ready to approve', tone: 'accent' }} />
              }),
              ...stuck.map(m => <Row key={`m${m.id}`} to={`/meetings/${m.id}`} title={<MeetingName m={m} />}
                detail={m.processing_error ?? (meetingStatus(m).key === 'transcribed' ? 'Transcript ready. Check it, then start the analysis.' : 'No recording or transcript uploaded yet.')} aside={fmtDate(m.scheduled_at)} status={meetingStatus(m)} />),
            ]}</ListBox>
          </Section>

          <div className="grid gap-x-8 gap-y-9 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section title="Upcoming tasks" count={upcoming.length} actions={<Link to="/tasks" className="text-sky hover:underline">All tasks</Link>}>
              <ListBox empty="No open tasks. Approved tasks from your meetings appear here.">{upcoming.slice(0, 7).map(t => {
                const waits = t.prerequisites.filter(p => p.status !== 'done' && p.status !== 'cancelled')
                const blocked = t.is_blocked || t.status === 'blocked'
                return <Row key={t.code} to={`/tasks?task=${t.code}`} title={<><span className="tnum shrink-0 text-[12.5px] font-normal text-faint">{t.code}</span><span className="truncate">{t.title}</span></>}
                  detail={<>{t.owner ?? 'Unassigned'}{blocked && <span className="text-cancel">{', waiting for '}{waits.map(p => `${p.code} ${p.title}`).join(', ') || t.blocked_reason || 'a prerequisite'}</span>}</>}
                  status={dueStatus(t, today)} />
              })}</ListBox>
            </Section>

            <Section title="Recently processed meetings" actions={<Link to="/meetings" className="text-sky hover:underline">All meetings</Link>}>
              <ListBox empty="No meetings yet.">{recent.map(m =>
                <Row key={m.id} to={`/meetings/${m.id}`} title={<MeetingName m={m} />} detail={fmtDate(m.scheduled_at)} status={meetingStatus(m)} />)}
              </ListBox>
            </Section>
          </div>
        </div>
      )}
    </>
  )
}
