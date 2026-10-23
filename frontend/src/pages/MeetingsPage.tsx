import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtDate } from '../lib/api'
import type { MeetingSummary } from '../types'
import { Plus } from 'lucide-react'
import { Empty, ErrorBox, Loading, PageHeader, Status, SyntheticTag, inputCls, useLoad } from '../components/ui'
import { BUSY, isSynthetic, meetingStatus } from '../lib/status'

const FILTERS: [string, string][] = [['', 'All statuses'], ['review', 'Needs review or ready'], ['processing', 'Processing'], ['approved', 'Approved'], ['failed', 'Failed'], ['rejected', 'Rejected'], ['empty', 'Not processed']]

export default function MeetingsPage() {
  const nav = useNavigate()
  const { data, error, loading, reload } = useLoad(() => api.get<MeetingSummary[]>('/api/meetings'), [],
    d => (d?.some(m => BUSY.includes(m.processing_status)) ? 4000 : undefined))
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const rows = (data ?? []).filter(m => (!status || meetingStatus(m).key === status) && (!q || m.title.toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      <PageHeader title="Meetings" sub="Every uploaded meeting, its processing state and where its proposed changes stand."
        actions={<Link to="/meetings/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13.5px] font-medium text-on-accent hover:bg-accent-hover"><Plus size={15} aria-hidden />New meeting</Link>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.length ? (
        <Empty action={<Link to="/meetings/new" className="font-medium text-sky hover:underline">Add a meeting</Link>}>No meetings yet.</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input aria-label="Search meetings" className={`${inputCls} max-w-[280px]`} placeholder="Search by title" value={q} onChange={e => setQ(e.target.value)} />
            <select aria-label="Status" className={`${inputCls} max-w-[220px]`} value={status} onChange={e => setStatus(e.target.value)}>
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="ml-auto text-[13px] text-faint">{rows.length} of {data.length}</span>
          </div>
          {!rows.length ? <Empty>No meeting matches.</Empty> : (
            <div className="overflow-x-auto rounded-lg border border-rule bg-panel">
              <table className="w-full text-left text-[14px]">
                <thead className="text-[12.5px] text-faint">
                  <tr className="border-b border-rule"><th className="py-2 pl-4 pr-4 font-medium">Meeting</th><th className="hidden py-2 pr-4 font-medium sm:table-cell">Date</th><th className="hidden py-2 pr-4 font-medium md:table-cell">Source</th><th className="py-2 pr-4 font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {rows.map(m => {
                    const st = meetingStatus(m)
                    const audio = m.source_type === 'audio' || m.source_type === 'video'
                    return (
                      <tr key={m.id} className="cursor-pointer border-b border-rule last:border-b-0 hover:bg-panel-2" onClick={() => nav(`/meetings/${m.id}`)}>
                        <td className="py-3 pl-4 pr-4">
                          <span className="flex items-center gap-2"><Link to={`/meetings/${m.id}`} className="font-medium text-ink hover:underline" onClick={e => e.stopPropagation()}>{m.title}</Link>{isSynthetic(m) && <SyntheticTag />}</span>
                          <div className="text-[12.5px] text-faint sm:hidden">{fmtDate(m.scheduled_at)}</div>
                          {m.processing_error && <div className="max-w-[60ch] text-[12.5px] text-cancel">{m.processing_error}</div>}
                        </td>
                        <td className="tnum hidden py-3 pr-4 text-slate sm:table-cell">{fmtDate(m.scheduled_at)}</td>
                        <td className="hidden py-3 pr-4 text-slate md:table-cell">{!m.source_type ? 'Nothing uploaded' : audio ? `Recording${m.stt_provider ? `, ${m.stt_provider}` : ''}` : 'Transcript'}{m.segments ? `, ${m.segments} segments` : ''}</td>
                        <td className="py-3 pr-4"><Status tone={st.tone} busy={st.busy}>{st.label}</Status></td>
                      </tr>)
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
