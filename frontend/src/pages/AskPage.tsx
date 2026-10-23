import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtTime } from '../lib/api'
import type { MeetingSummary, Passage } from '../types'
import { Button, PageHeader, Spinner, Status, type Tone, errText, inputCls, useLoad } from '../components/ui'
import { taskLabel } from '../lib/status'

interface Answer {
  question: string; answer: string; found: boolean; mode: string; citations: Passage[]; passages: Passage[]
  current_state: { code: string; title: string; owner: string | null; status: string; due_date: string | null; revision: number }[]
  llm?: { provider: string; model: string }; llm_error?: string; note?: string
}
interface Turn { id: number; question: string; useLlm: boolean; state: 'pending' | 'done' | 'error'; res?: Answer; error?: string }

const DOC: Record<string, string> = { segment: 'Transcript', decision: 'Approved decision', task: 'Task board', question: 'Open question' }

/** The five outcomes are deliberately distinct: an answer, no support in the records, nothing
 *  found at all, a model failure, and a failed request. */
function outcome(t: Turn): { label: string; tone: Tone; detail: string } {
  if (t.state === 'error') return { label: 'Request failed', tone: 'cancel', detail: `The question did not reach the meeting records: ${t.error}` }
  const r = t.res!
  if (r.mode === 'llm_grounded' && r.found) return { label: 'Answer from the meeting records', tone: 'done', detail: `Written by ${r.llm?.provider}/${r.llm?.model} using only the cited passages.` }
  if (r.mode === 'llm_grounded') return { label: 'Not supported by the meeting records', tone: 'ask', detail: `Stored passages matched the question, but none of them supports an answer (${r.note ?? 'no valid citation'}). Closest passages are shown; they are not an answer.` }
  if (r.mode === 'retrieval') return { label: 'Nothing found in stored meetings', tone: 'neutral', detail: 'No stored transcript line, decision or task matches this question.' }
  if (r.llm_error) return { label: 'Model unavailable', tone: 'cancel', detail: `The language model could not be reached (${r.llm_error}). These are the closest stored passages, not an answer.` }
  return { label: 'Search results', tone: 'neutral', detail: 'No answer was written (the model is switched off). These are the closest stored passages.' }
}

function Sources({ list, numbered }: { list: Passage[]; numbered: boolean }) {
  return (
    <ol className="mt-2 space-y-2.5">
      {list.map((p, i) => {
        const href = p.meeting_id ? `/meetings/${p.meeting_id}${p.seg_key ? `#${p.seg_key}` : ''}` : undefined
        return (
          <li key={p.passage_id} className="border-l-2 border-rule-strong pl-3">
            <div className="text-[12.5px] text-faint">{numbered ? `[${i + 1}] ` : ''}{DOC[p.doc_type] ?? p.doc_type}{p.speaker ? `, ${p.speaker} at ${fmtTime(p.start_seconds)}` : ''}</div>
            <p className={p.doc_type === 'segment' ? 'spoken text-ink' : 'text-ink'}>{p.doc_type === 'segment' ? `“${p.text}”` : p.text}</p>
            {href && <Link to={href} className="text-[12.5px] text-sky hover:underline">{p.meeting_title} ({fmtDate(p.meeting_date)}){p.seg_key ? `, segment ${p.seg_key}` : ''}</Link>}
          </li>)
      })}
    </ol>
  )
}

function Reply({ t, retry }: { t: Turn; retry: () => void }) {
  if (t.state === 'pending') return <p role="status" className="flex items-center gap-2 text-slate"><Spinner />Searching stored meetings{t.useLlm ? ', then asking the model (a minute or more on a local model)' : ''}…</p>
  const o = outcome(t)
  const r = t.res
  return (
    <div className="space-y-2">
      <Status tone={o.tone}>{o.label}</Status>
      {r && r.mode === 'llm_grounded' && r.found && <p className="text-[15px] text-ink">{r.answer}</p>}
      <p className="text-[13px] text-slate">{o.detail}</p>
      {t.state === 'error' && <Button size="sm" onClick={retry}>Try again</Button>}
      {r && r.citations.length > 0 && <div><h3 className="text-[13px] font-semibold text-slate">{r.found && r.mode === 'llm_grounded' ? 'Sources' : 'Closest passages'}</h3><Sources list={r.citations} numbered={r.mode === 'llm_grounded'} /></div>}
      {r && !r.citations.length && r.passages.length > 0 && <div><h3 className="text-[13px] font-semibold text-slate">Closest passages (not an answer)</h3><Sources list={r.passages.slice(0, 3)} numbered={false} /></div>}
      {r && r.current_state.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-slate">Current approved state</h3>
          <ul className="mt-1 space-y-1 text-[13.5px]">{r.current_state.map(s => (
            <li key={s.code}><Link to={`/tasks?task=${s.code}`} className="text-sky hover:underline">{s.code}</Link> <span className="text-ink">{s.title}</span>
              <span className="text-slate">: {s.owner ?? 'unassigned'}, due {fmtDate(s.due_date)}, {taskLabel(s.status)}, revision {s.revision}</span></li>))}
          </ul>
          <p className="mt-1 text-[12.5px] text-faint">This can differ from what was said if a later meeting changed the task.</p>
        </div>
      )}
    </div>
  )
}

export default function AskPage() {
  const scope = useLoad(() => api.get<MeetingSummary[]>('/api/meetings'))
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [useLlm, setUseLlm] = useState(true)
  const end = useRef<HTMLDivElement>(null)
  const busy = turns.some(t => t.state === 'pending')
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [turns])

  async function run(id: number, question: string, llm: boolean) {
    setTurns(ts => ts.map(t => (t.id === id ? { ...t, state: 'pending', error: undefined } : t)))
    try {
      const res = await api.post<Answer>('/api/memory/query', { question, use_llm: llm })
      setTurns(ts => ts.map(t => (t.id === id ? { ...t, state: 'done', res } : t)))
    } catch (e) { setTurns(ts => ts.map(t => (t.id === id ? { ...t, state: 'error', error: errText(e) } : t))) }
  }
  function send(e?: FormEvent) {
    e?.preventDefault()
    const question = q.trim()
    if (question.length < 2 || busy) return
    const id = Date.now()
    setTurns(ts => [...ts, { id, question, useLlm, state: 'pending' }])
    setQ('')
    void run(id, question, useLlm)
  }
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  const nMeet = scope.data?.length ?? 0
  const nSeg = scope.data?.reduce((n, m) => n + m.segments, 0) ?? 0

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="Ask AI" sub="Answers come only from stored transcripts, approved decisions and the task board, with each source shown." />
      <div className="max-w-[760px] flex-1 space-y-6" aria-live="polite">
        {!turns.length && (
          <p className="text-[14px] text-slate">Ask about owners, deadlines, decisions or what was said. If nothing stored supports an answer, you are told so instead of getting a guess.</p>
        )}
        {turns.map(t => (
          <div key={t.id} className="space-y-3">
            <div className="flex justify-end"><p className="max-w-[85%] rounded-lg bg-panel-3 px-3.5 py-2 text-ink">{t.question}</p></div>
            <div className="border-l-2 border-rule pl-4"><Reply t={t} retry={() => run(t.id, t.question, t.useLlm)} /></div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="sticky bottom-3 mt-6 max-w-[760px] rounded-lg border border-rule-strong bg-panel p-2.5 shadow-pop">
        <textarea aria-label="Question" rows={2} className={`${inputCls} h-auto resize-none py-2`} placeholder="Who owns the regression tests, and when are they due?"
          value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[13px] text-slate"><input type="checkbox" className="accent-[var(--accent)]" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />Write an answer with the model</label>
          <span className="text-[12.5px] text-faint">{scope.data ? `Searches ${nMeet} meeting${nMeet === 1 ? '' : 's'} (${nSeg} transcript segments), decisions and tasks.` : ''}</span>
          <Button kind="primary" type="submit" disabled={q.trim().length < 2 || busy} loading={busy}>Ask</Button>
        </div>
      </form>
    </div>
  )
}
