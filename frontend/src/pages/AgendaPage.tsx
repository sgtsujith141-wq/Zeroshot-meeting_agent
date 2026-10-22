import { Link } from 'react-router-dom'
import { api, download, fmtDate } from '../lib/api'
import { Button, Empty, ErrorBox, Loading, PageHeader, Panel, useLoad } from '../components/ui'

interface Row { code: string; title: string; owner: string | null; status: string; due_date: string | null; meeting_id: number; meeting_title: string; waiting_for?: string[] }
interface Agenda {
  as_of: string; timezone: string; markdown: string
  sections: { overdue: Row[]; blocked: Row[]; due_within_7_days: Row[]; open_without_due_date: Row[]; other_open: Row[]
    open_questions: { id: number; text: string; meeting_id: number; meeting_title: string }[]
    pending_reviews: { change_set_id: number; meeting_id: number; meeting_title: string; state: string; unanswered_questions: string[] }[] }
}

const TASK_SECTIONS: [keyof Agenda['sections'], string][] = [
  ['overdue', 'Overdue'], ['blocked', 'Blocked'], ['due_within_7_days', 'Due within 7 days'],
  ['open_without_due_date', 'Open, no due date'], ['other_open', 'Other open items'],
]

export default function AgendaPage() {
  const { data, error, loading, reload } = useLoad(() => api.get<Agenda>('/api/agenda'))
  if (loading && !data) return <Loading />
  const s = data?.sections
  const empty = s && TASK_SECTIONS.every(([k]) => !(s[k] as Row[]).length) && !s.open_questions.length && !s.pending_reviews.length
  return (
    <>
      <PageHeader title="Next meeting agenda" sub={data && <>Built from the task board, open questions and pending reviews as of {fmtDate(data.as_of)} ({data.timezone}).</>}>
        <Button onClick={() => download('/api/agenda.md', `agenda-${data?.as_of}.md`)} disabled={!data}>Download as Markdown</Button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      {empty && <Empty>Nothing is pending. Approved open tasks and unresolved questions will appear here.</Empty>}
      {s && (
        <div className="space-y-6">
          {TASK_SECTIONS.map(([k, label]) => (s[k] as Row[]).length > 0 && (
            <Panel key={k} title={`${label} (${(s[k] as Row[]).length})`}>
              <ul className="space-y-2">{(s[k] as Row[]).map(r => (
                <li key={r.code} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><span className="text-slate">{r.code}</span> <span className="font-medium">{r.title}</span>, {r.owner ?? 'unassigned'}, due {fmtDate(r.due_date)}{r.waiting_for?.length ? `, waiting for ${r.waiting_for.join(', ')}` : ''}</span>
                  <Link to={`/meetings/${r.meeting_id}`} className="text-[13px] text-update hover:underline">from {r.meeting_title}</Link>
                </li>))}
              </ul>
            </Panel>
          ))}
          {s.open_questions.length > 0 && (
            <Panel title={`Unresolved questions (${s.open_questions.length})`}>
              <ul className="space-y-2">{s.open_questions.map(q => (
                <li key={q.id} className="flex flex-wrap justify-between gap-2"><span>{q.text}</span><Link to={`/meetings/${q.meeting_id}`} className="text-[13px] text-update hover:underline">from {q.meeting_title}</Link></li>))}
              </ul>
            </Panel>
          )}
          {s.pending_reviews.length > 0 && (
            <Panel title="Reviews not yet approved">
              <ul className="space-y-3">{s.pending_reviews.map(p => (
                <li key={p.change_set_id}><Link to={`/review/${p.meeting_id}`} className="font-medium text-update hover:underline">{p.meeting_title}</Link>
                  {p.unanswered_questions.length > 0 && <ul className="mt-1 list-disc pl-5 text-[14px] text-slate">{p.unanswered_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
                </li>))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </>
  )
}
