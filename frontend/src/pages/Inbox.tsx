import { Link } from 'react-router-dom'
import { api, fmtDate } from '../lib/api'
import type { MeetingSummary, Task } from '../types'
import { Empty, ErrorBox, Loading, PageHeader, StateChip, useLoad } from '../components/ui'

interface CsRow { id: number; meeting_id: number; meeting_title: string; state: string; items: number; open_questions: number }

const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']

export default function Inbox() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [meetings, changesets, tasks] = await Promise.all([
      api.get<MeetingSummary[]>('/api/meetings'), api.get<CsRow[]>('/api/changesets'), api.get<Task[]>('/api/tasks')])
    return { meetings, changesets, tasks }
  }, [], d => (d?.meetings.some(m => BUSY.includes(m.processing_status)) ? 3000 : undefined))

  const today = new Date().toISOString().slice(0, 10)
  const open = data?.tasks.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)) ?? []
  const pending = data?.changesets.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)) ?? []
  const counts = data && [
    { label: 'Reviews waiting', value: pending.length, to: '/review' },
    { label: 'Open questions in reviews', value: pending.reduce((n, c) => n + c.open_questions, 0), to: '/review' },
    { label: 'Open tasks', value: open.length, to: '/tasks' },
    { label: 'Blocked tasks', value: open.filter(t => t.is_blocked).length, to: '/tasks' },
    { label: 'Overdue', value: open.filter(t => t.due_date && t.due_date < today).length, to: '/agenda' },
  ]

  return (
    <>
      <PageHeader title="Meetings" sub="Every count below is computed from the stored meetings, reviews and tasks.">
        <Link to="/meetings/new" className="rounded-md bg-create px-3 py-1.5 text-[14px] font-medium text-white hover:bg-[#0b5a5a]">Add a meeting</Link>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      {counts && (
        <dl className="mb-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          {counts.map(c => (
            <Link key={c.label} to={c.to} className="group">
              <dd className="text-[1.75rem] font-semibold leading-none tabular-nums group-hover:text-update">{c.value}</dd>
              <dt className="mt-1 text-[13px] text-slate">{c.label}</dt>
            </Link>
          ))}
        </dl>
      )}
      {loading && !data ? <Loading /> : data && data.meetings.length === 0 ? (
        <Empty>
          No meetings yet. <Link to="/meetings/new" className="font-medium text-update underline">Add a meeting</Link> by uploading a consented recording or a transcript.
        </Empty>
      ) : data && (
        <div className="overflow-x-auto rounded-[10px] border border-rule bg-panel">
          <table className="w-full min-w-[640px] text-left text-[14.5px]">
            <thead className="border-b border-rule text-[13px] text-slate">
              <tr><th className="px-4 py-2 font-medium">Meeting</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Processing</th><th className="px-4 py-2 font-medium">Review</th></tr>
            </thead>
            <tbody>
              {data.meetings.map(m => (
                <tr key={m.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-2.5"><Link to={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link></td>
                  <td className="px-4 py-2.5 text-slate">{fmtDate(m.scheduled_at)}</td>
                  <td className="px-4 py-2.5 text-slate">{m.source_type ? `${m.source_type}${m.segments ? `, ${m.segments} segments` : ''}` : 'nothing uploaded'}</td>
                  <td className="px-4 py-2.5"><StateChip state={m.processing_status} />{m.processing_error && <div className="mt-1 max-w-[36ch] text-[12.5px] text-cancel">{m.processing_error}</div>}</td>
                  <td className="px-4 py-2.5">{m.change_set ? <Link to={`/review/${m.id}`}><StateChip state={m.change_set.state} /></Link> : <span className="text-slate">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
