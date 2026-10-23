import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CalendarClock, ChevronRight, ClipboardCheck, FileAudio, FileText, History, Link2, Plus } from 'lucide-react'
import { api, fmtDate } from '../lib/api'
import type { MeetingSummary, Task } from '../types'
import { Avatar, Chip, Empty, ErrorBox, PageHeader, Panel, Skeleton, StateChip, useLoad } from '../components/ui'

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number; updated_at: string }
interface Audit { id: number; actor: string; object_type: string; object_id: string; action: string; result: string; created_at: string }

const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']
const todayIso = () => new Date().toISOString().slice(0, 10)

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return fmtDate(iso)
}

function describe(a: Audit, cs: Map<string, CsRow>, meetings: Map<string, MeetingSummary>): string | null {
  const m = (id: string) => meetings.get(id)?.title ?? `meeting ${id}`
  const c = (id: string) => cs.get(id)?.meeting_title ?? `change set ${id}`
  switch (`${a.object_type}:${a.action}`) {
    case 'changeset:approve': return `Approved changes from “${c(a.object_id)}”`
    case 'changeset:reject': return `Rejected changes from “${c(a.object_id)}”`
    case 'changeset:apply': return a.result === 'failed' ? `Applying “${c(a.object_id)}” failed` : null
    case 'changeset:edit': return `Answered or edited the review of “${c(a.object_id)}”`
    case 'task:create': return `Created ${a.object_id}`
    case 'task:update': return `Updated ${a.object_id} from a meeting`
    case 'task:edit': return `Edited ${a.object_id} on the board`
    case 'task:cancel': return `Cancelled ${a.object_id}`
    case 'task:complete': return `Marked ${a.object_id} done`
    case 'meeting:create': return `Added “${m(a.object_id)}”`
    case 'meeting:upload': return `Uploaded a file to “${m(a.object_id)}”`
    case 'meeting:process': return `Re-ran analysis of “${m(a.object_id)}”`
    case 'meeting:delete': return `Deleted meeting ${a.object_id}`
    case 'participant:map': return `Named a speaker in meeting ${a.object_id.split(':')[0]}`
    case 'reminder:deliver': return a.result === 'delivered' ? 'Delivered an in-app reminder' : null
    case 'reminder:approve': return 'Approved a reminder'
    case 'summary:prepare': return 'Prepared a meeting summary'
    default: return null
  }
}

export default function Inbox() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [meetings, changesets, tasks, audit] = await Promise.all([
      api.get<MeetingSummary[]>('/api/meetings'), api.get<CsRow[]>('/api/changesets'), api.get<Task[]>('/api/tasks'),
      api.get<Audit[]>('/api/audit?limit=60')])
    return { meetings, changesets, tasks, audit }
  }, [], d => (d?.meetings.some(m => BUSY.includes(m.processing_status)) ? 4000 : undefined))

  const today = todayIso()
  const open = data?.tasks.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)) ?? []
  const pending = data?.changesets.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)) ?? []
  const deadlines = open.filter(t => t.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)).slice(0, 6)
  const blocked = open.filter(t => t.is_blocked)
  const csMap = new Map((data?.changesets ?? []).map(c => [String(c.id), c]))
  const mMap = new Map((data?.meetings ?? []).map(m => [String(m.id), m]))
  const activity = (data?.audit ?? []).map(a => ({ a, text: describe(a, csMap, mMap) })).filter(x => x.text).slice(0, 8)
  const latestCs = new Map<number, CsRow>()
  for (const c of data?.changesets ?? []) if (!latestCs.has(c.meeting_id)) latestCs.set(c.meeting_id, c)

  return (
    <>
      <PageHeader title="Overview" sub="What needs a decision, what is due, and what changed. Everything here comes from stored meetings, reviews and tasks.">
        {pending.length > 0 && <Link to="/review" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule-strong bg-panel-2 px-3 text-[13.5px] font-medium hover:bg-panel-3"><ClipboardCheck size={15} />Review {pending.length} pending</Link>}
        <Link to="/meetings/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13.5px] font-medium text-on-accent hover:bg-accent-hover"><Plus size={15} />New meeting</Link>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />

      {loading && !data ? (
        <div className="grid gap-5 lg:grid-cols-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44" />)}</div>
      ) : data && data.meetings.length === 0 ? (
        <Empty icon={<FileAudio size={22} />} action={<Link to="/meetings/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13.5px] font-medium text-on-accent"><Plus size={15} />Add your first meeting</Link>}>
          No meetings yet. Upload a consented recording or a transcript to get proposed tasks to review.
        </Empty>
      ) : data && (
        <div className="space-y-5">
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Panel title={<>Needs your review <span className="ml-1 font-normal text-faint tnum">{pending.length}</span></>} icon={<ClipboardCheck size={15} />} flush
              actions={<Link to="/review" className="text-[13px] text-sky hover:underline">All reviews</Link>}>
              {!pending.length ? <p className="px-4 py-5 text-[14px] text-faint">Nothing is waiting for approval.</p> : (
                <ul className="divide-y divide-rule">{pending.map(c => (
                  <li key={c.id}><Link to={`/review/${c.meeting_id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2">
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{c.meeting_title}</span>
                      <span className="text-[12.5px] text-faint">{c.items} proposed item{c.items === 1 ? '' : 's'}</span></span>
                    {c.open_questions > 0 ? <Chip tone="ask">{c.open_questions} question{c.open_questions === 1 ? '' : 's'}</Chip> : <StateChip state={c.state} />}
                    <ChevronRight size={16} className="text-faint" />
                  </Link></li>))}
                </ul>
              )}
            </Panel>

            <Panel title={<>Upcoming deadlines <span className="ml-1 font-normal text-faint tnum">{deadlines.length}</span></>} icon={<CalendarClock size={15} />} flush
              actions={<Link to="/tasks" className="text-[13px] text-sky hover:underline">Task board</Link>}>
              {!deadlines.length ? <p className="px-4 py-5 text-[14px] text-faint">No open task has a due date.</p> : (
                <ul className="divide-y divide-rule">{deadlines.map(t => {
                  const overdue = t.due_date! < today
                  return (
                    <li key={t.code} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`tnum w-[92px] shrink-0 text-[13px] ${overdue ? 'font-medium text-cancel' : t.due_date === today ? 'font-medium text-ask' : 'text-slate'}`}>
                        {overdue ? 'Overdue ' : ''}{new Date(t.due_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                      <span className="min-w-0 flex-1 truncate"><span className="tnum mr-2 text-[12.5px] text-faint">{t.code}</span>{t.title}</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-slate"><Avatar name={t.owner} size={20} /><span className="hidden sm:inline">{t.owner ?? 'Unassigned'}</span></span>
                    </li>)
                })}
                </ul>
              )}
            </Panel>

            <Panel title={<>Blocked <span className="ml-1 font-normal text-faint tnum">{blocked.length}</span></>} icon={<AlertCircle size={15} />} flush>
              {!blocked.length ? <p className="px-4 py-5 text-[14px] text-faint">No open task is waiting on another.</p> : (
                <ul className="divide-y divide-rule">{blocked.map(t => (
                  <li key={t.code} className="px-4 py-2.5">
                    <div className="flex items-center gap-2"><span className="tnum text-[12.5px] text-faint">{t.code}</span><span className="min-w-0 flex-1 truncate font-medium">{t.title}</span><Avatar name={t.owner} size={20} /></div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate">
                      <Link2 size={12} className="text-faint" />Waiting for {t.prerequisites.filter(p => p.status !== 'done').map(p => `${p.code} ${p.title}`).join(', ') || t.blocked_reason}
                    </div>
                  </li>))}
                </ul>
              )}
            </Panel>

            <Panel title="Recent activity" icon={<History size={15} />} flush>
              {!activity.length ? <p className="px-4 py-5 text-[14px] text-faint">No recorded activity yet.</p> : (
                <ol className="divide-y divide-rule">{activity.map(({ a, text }) => (
                  <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-[13.5px]">
                    <span className="min-w-0 flex-1 text-ink">{text}</span>
                    <span className="shrink-0 text-[12.5px] text-faint" title={new Date(a.created_at).toLocaleString()}>{a.actor === 'system' || a.actor === 'reminder-worker' ? 'automatic, ' : ''}{ago(a.created_at)}</span>
                  </li>))}
                </ol>
              )}
            </Panel>
          </div>

          <Panel title={<>Meetings <span className="ml-1 font-normal text-faint tnum">{data.meetings.length}</span></>} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px] sm:min-w-[640px]">
                <thead className="text-[12.5px] text-faint">
                  <tr className="border-b border-rule"><th className="px-4 py-2 font-medium">Meeting</th><th className="hidden px-4 py-2 font-medium sm:table-cell">Date</th><th className="hidden px-4 py-2 font-medium sm:table-cell">Source</th><th className="px-4 py-2 font-medium">Review</th><th className="w-8" /></tr>
                </thead>
                <tbody>
                  {data.meetings.map(m => {
                    const cs = latestCs.get(m.id)
                    const audio = m.source_type === 'audio' || m.source_type === 'video'
                    const source = m.source_type ? (audio ? `Audio${m.stt_provider ? `, ${m.stt_provider}` : ''}` : 'Transcript') : 'Nothing uploaded'
                    return (
                      <tr key={m.id} className="group border-b border-rule last:border-0 hover:bg-panel-2">
                        <td className="px-4 py-2.5"><Link to={`/meetings/${m.id}`} className="font-medium text-ink group-hover:text-sky">{m.title}</Link>
                          <div className="tnum mt-0.5 text-[12.5px] text-faint sm:hidden">{fmtDate(m.scheduled_at)}, {source.toLowerCase()}</div>
                          {m.processing_error && <div className="mt-0.5 max-w-[48ch] text-[12.5px] text-cancel">{m.processing_error}</div>}</td>
                        <td className="tnum hidden px-4 py-2.5 text-slate sm:table-cell">{fmtDate(m.scheduled_at)}</td>
                        <td className="hidden px-4 py-2.5 text-slate sm:table-cell"><span className="inline-flex items-center gap-1.5">{audio ? <FileAudio size={14} className="text-faint" /> : <FileText size={14} className="text-faint" />}
                          <span>{source}{m.segments ? <span className="text-faint">{`, ${m.segments} segments`}</span> : null}</span></span></td>
                        <td className="px-4 py-2.5">{BUSY.includes(m.processing_status) || m.processing_status === 'failed' ? <StateChip state={m.processing_status} />
                          : cs ? <Link to={`/review/${m.id}`}><StateChip state={cs.state} /></Link> : <span className="text-faint">Not analysed</span>}</td>
                        <td className="px-2"><Link to={`/meetings/${m.id}`} aria-label={`Open ${m.title}`} className="text-faint hover:text-ink"><ArrowRight size={15} /></Link></td>
                      </tr>)
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}
