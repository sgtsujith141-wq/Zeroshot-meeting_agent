import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpenText, CheckCircle2, CircleSlash, KanbanSquare, MessageSquareQuote, Search, Sparkles } from 'lucide-react'
import { api, fmtDate, fmtTime } from '../lib/api'
import type { MeetingSummary, Passage } from '../types'
import { Button, Chip, ErrorBox, PageHeader, Panel, Skeleton, StateChip, errText, useLoad } from '../components/ui'

interface Answer {
  question: string; answer: string; found: boolean; mode: string; citations: Passage[]; passages: Passage[]
  current_state: { code: string; title: string; owner: string | null; status: string; due_date: string | null; revision: number }[]
  llm?: { provider: string; model: string }; llm_error?: string; note?: string
}

const MODE: Record<string, string> = {
  llm_grounded: 'Written by the model from the cited passages only',
  extractive: 'No model answer; the closest stored passages are shown',
  retrieval: 'Search only',
}
const DOC: Record<string, string> = { segment: 'Transcript', decision: 'Approved decision', task: 'Task board', question: 'Open question' }

function PassageCard({ p }: { p: Passage }) {
  const href = p.meeting_id ? `/meetings/${p.meeting_id}${p.seg_key ? `#${p.seg_key}` : ''}` : undefined
  return (
    <li className="rounded-lg border border-rule bg-panel-2 px-3.5 py-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="tnum font-medium text-slate">{p.passage_id}</span>
        <Chip icon={p.doc_type === 'segment' ? <MessageSquareQuote size={12} /> : p.doc_type === 'task' ? <KanbanSquare size={12} /> : <CheckCircle2 size={12} />}>{DOC[p.doc_type] ?? p.doc_type}</Chip>
        {p.speaker && <span className="text-faint">{p.speaker} at <span className="tnum">{fmtTime(p.start_seconds)}</span></span>}
      </div>
      <p className={p.doc_type === 'segment' ? 'spoken text-ink' : 'text-ink'}>{p.doc_type === 'segment' ? `“${p.text}”` : p.text}</p>
      {href && (
        <Link to={href} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-sky hover:underline">
          {p.meeting_title} ({fmtDate(p.meeting_date)}){p.seg_key ? `, segment ${p.seg_key}` : ''}<ArrowUpRight size={12} />
        </Link>
      )}
    </li>
  )
}

export default function MemoryPage() {
  const scope = useLoad(() => api.get<MeetingSummary[]>('/api/meetings'))
  const [q, setQ] = useState('')
  const [useLlm, setUseLlm] = useState(true)
  const [res, setRes] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function ask(e: FormEvent) {
    e.preventDefault()
    if (q.trim().length < 2) return
    setBusy(true); setErr(null); setRes(null)
    try { setRes(await api.post<Answer>('/api/memory/query', { question: q.trim(), use_llm: useLlm })) }
    catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  const nMeet = scope.data?.length ?? 0
  const nSeg = scope.data?.reduce((n, m) => n + m.segments, 0) ?? 0
  return (
    <>
      <PageHeader title="Ask past meetings" sub="Answers come only from stored transcripts, approved decisions and the current task board, with the source shown for each." />
      <form onSubmit={ask} className="mb-2 rounded-xl border border-rule bg-panel p-2 shadow-soft focus-within:border-sky/60">
        <div className="flex items-center gap-2">
          <Search size={18} className="ml-2 shrink-0 text-faint" />
          <input className="h-10 min-w-0 flex-1 bg-transparent text-[15.5px] text-ink placeholder:text-faint focus:outline-none" aria-label="Question"
            placeholder="Who owns the regression tests, and when are they due?" value={q} onChange={e => setQ(e.target.value)} minLength={2} required />
          <Button kind="primary" type="submit" loading={busy} disabled={q.trim().length < 2}>Ask</Button>
        </div>
      </form>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 px-1 text-[12.5px] text-faint">
        <span>{scope.data ? `Searches ${nMeet} stored meeting${nMeet === 1 ? '' : 's'} (${nSeg} transcript segments), approved decisions and the task board.` : 'Loading scope…'}</span>
        <label className="flex items-center gap-1.5 text-slate"><input type="checkbox" className="accent-[var(--accent)]" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />Write an answer with the model</label>
      </div>
      <ErrorBox error={err} />

      {busy && (
        <div role="status" aria-label="Searching" className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-xl border border-rule bg-panel p-4"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20" /><Skeleton className="h-20" />
            <p className="text-[12.5px] text-faint">Searching stored meetings{useLlm ? ', then asking the configured model (this can take a minute on a local model)' : ''}…</p></div>
          <Skeleton className="h-40" />
        </div>
      )}

      {!busy && !res && !err && (
        <div className="rounded-xl border border-dashed border-rule-strong px-6 py-10 text-center text-[14px] text-slate">
          <BookOpenText size={22} className="mx-auto mb-2 text-faint" />
          Ask about owners, deadlines, decisions or what was said. If nothing stored supports an answer, you will see “not found in stored meetings”.
        </div>
      )}

      {res && !busy && (
        <div className="anim-in grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Panel title="Answer" icon={res.found ? <Sparkles size={15} /> : <CircleSlash size={15} />}>
            <p className={`text-[16px] leading-relaxed ${res.found ? 'text-ink' : 'text-slate'}`}>{res.answer}</p>
            <p className="mt-2 text-[12.5px] text-faint">{MODE[res.mode] ?? res.mode}{res.llm && ` (${res.llm.provider}/${res.llm.model})`}.{res.llm_error && ` Model unavailable: ${res.llm_error}.`}{res.note && ` ${res.note}.`}</p>
            {res.citations.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-[13px] font-semibold text-slate">What was originally said or recorded</h3>
                <ul className="space-y-2.5">{res.citations.map(p => <PassageCard key={p.passage_id} p={p} />)}</ul>
              </>
            )}
            {!res.found && res.passages.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-[13px] font-semibold text-slate">Closest stored passages (not confirmed as an answer)</h3>
                <ul className="space-y-2.5">{res.passages.slice(0, 3).map(p => <PassageCard key={p.passage_id} p={p} />)}</ul>
              </>
            )}
          </Panel>
          <Panel title="Current approved state" icon={<KanbanSquare size={15} />}>
            {!res.current_state.length ? <p className="text-[14px] text-faint">No approved task is linked to these passages.</p> : (
              <ul className="space-y-3">{res.current_state.map(t => (
                <li key={t.code}>
                  <div><span className="tnum mr-1.5 text-[12.5px] text-faint">{t.code}</span><span className="font-medium">{t.title}</span></div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13.5px] text-slate"><StateChip state={t.status} />{t.owner ?? 'Unassigned'}, due {fmtDate(t.due_date)}, revision {t.revision}</div>
                </li>))}
              </ul>
            )}
            <p className="mt-4 text-[12.5px] text-faint">This can differ from what was said if a later meeting changed the task.</p>
          </Panel>
        </div>
      )}
    </>
  )
}
