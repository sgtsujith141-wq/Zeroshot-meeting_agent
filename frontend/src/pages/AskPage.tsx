import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { api, fmtDate, fmtTime } from '../lib/api'
import type { MeetingSummary, Passage, Task } from '../types'
import { Button, PageHeader, Spinner, Status, type Tone, errText, useLoad } from '../components/ui'
import { OPEN_TASK, taskLabel } from '../lib/status'

interface Answer {
  question: string; answer: string; found: boolean; mode: string; citations: Passage[]; passages: Passage[]
  current_state: { code: string; title: string; owner: string | null; status: string; due_date: string | null; revision: number; waiting_for?: string[] }[]
  clarify?: { code: string; title: string }[]
  llm?: { provider: string; model: string; latency_ms?: number }; llm_error?: string; note?: string; latency_ms?: number
}
interface Turn {
  id: number; question: string; useLlm: boolean; state: 'pending' | 'done' | 'error'; res?: Answer; error?: string
  started: number; ms?: number; early?: Passage[]; earlyMs?: number
}

const DOC: Record<string, string> = { segment: 'Transcript', decision: 'Approved decision', task: 'Task board', question: 'Open question' }
const took = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`)

/** Each outcome is distinct: an answer from the task records, an answer written from cited
 *  passages, no support in the records, nothing found at all, a model failure, a failed request. */
function outcome(t: Turn): { label: string; tone: Tone; detail: string } {
  if (t.state === 'error') return { label: 'Request failed', tone: 'cancel', detail: `The question did not reach the meeting records: ${t.error}` }
  const r = t.res!
  if (r.mode === 'task_records' && r.clarify?.length) return { label: 'Which task do you mean?', tone: 'ask', detail: 'Several approved tasks match. Pick one and the question is asked again for that task.' }
  if (r.mode === 'task_records') return { label: 'Answer from approved task records', tone: 'done', detail: 'Read straight from the approved task board. No language model was needed.' }
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

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(performance.now())
  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 500); return () => clearInterval(t) }, [])
  return <span className="tnum">{Math.floor((now - since) / 1000)} s</span>
}

function Reply({ t, retry, pick }: { t: Turn; retry: () => void; pick: (code: string) => void }) {
  if (t.state === 'pending') return (
    <div className="space-y-2">
      <p role="status" className="flex items-center gap-2 text-slate"><Spinner />
        {t.useLlm ? <>Checking the task records, then writing an answer from the passages below<span className="text-faint">, <Elapsed since={t.started} /></span></> : 'Searching stored meetings…'}
      </p>
      {t.early && t.early.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-slate">Passages found <span className="font-normal text-faint">in {took(t.earlyMs!)}, while the answer is written</span></h3>
          <Sources list={t.early.slice(0, 4)} numbered={false} />
        </div>
      )}
    </div>
  )
  const o = outcome(t)
  const r = t.res
  const answered = r && r.found && ['llm_grounded', 'task_records'].includes(r.mode)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status tone={o.tone}>{o.label}</Status>
        {t.ms != null && <span className="tnum text-[12.5px] text-faint">Answered in {took(t.ms)}</span>}
      </div>
      {answered && <p className="text-[15px] text-ink">{r.answer}</p>}
      {r?.clarify?.length ? (
        <div className="flex flex-wrap gap-2">{r.clarify.map(c => <Button key={c.code} size="sm" onClick={() => pick(c.code)}><span className="tnum text-faint">{c.code}</span>{c.title}</Button>)}</div>
      ) : null}
      <p className="text-[13px] text-slate">{o.detail}</p>
      {t.state === 'error' && <Button size="sm" onClick={retry}>Try again</Button>}
      {r && r.citations.length > 0 && <div><h3 className="text-[13px] font-semibold text-slate">{r.mode === 'task_records' ? 'Where this was agreed' : r.found && r.mode === 'llm_grounded' ? 'Sources' : 'Closest passages'}</h3><Sources list={r.citations} numbered={r.mode === 'llm_grounded'} /></div>}
      {r && !r.citations.length && r.passages.length > 0 && <div><h3 className="text-[13px] font-semibold text-slate">Closest passages (not an answer)</h3><Sources list={r.passages.slice(0, 3)} numbered={false} /></div>}
      {r && r.current_state.length > 0 && !r.clarify?.length && (
        <div>
          <h3 className="text-[13px] font-semibold text-slate">Current approved state</h3>
          <ul className="mt-1 space-y-1 text-[13.5px]">{r.current_state.map(s => (
            <li key={s.code}><Link to={`/tasks?task=${s.code}`} className="text-sky hover:underline">{s.code}</Link> <span className="text-ink">{s.title}</span>
              <span className="text-slate">: {s.owner ?? 'unassigned'}, {s.due_date ? `due ${fmtDate(s.due_date)}` : 'no deadline'}, {taskLabel(s.status)}{s.waiting_for?.length ? `, waiting for ${s.waiting_for.join(', ')}` : ''}</span></li>))}
          </ul>
          {r.mode !== 'task_records' && <p className="mt-1 text-[12.5px] text-faint">This can differ from what was said if a later meeting changed the task.</p>}
        </div>
      )}
    </div>
  )
}

/** Example questions built from what is actually stored, so every suggestion has an answer. */
function suggestions(tasks: Task[], meetings: MeetingSummary[]): string[] {
  const open = tasks.filter(t => OPEN_TASK.includes(t.status))
  const out: string[] = []
  const owned = open.find(t => t.owner)
  if (owned) out.push(`Who owns “${owned.title}”, and when is it due?`)
  if (open.length) out.push('What is still pending?')
  if (open.some(t => t.is_blocked || t.status === 'blocked')) out.push('Which tasks are blocked?')
  const person = open.find(t => t.owner && t.owner !== owned?.owner)?.owner ?? owned?.owner
  if (person) out.push(`What is ${person} working on?`)
  const processed = meetings.find(m => m.processing_status === 'ready_for_review' && m.segments > 0)
  if (processed) out.push(`What was decided in “${processed.title}”, and why?`)
  return out
}

export default function AskPage() {
  const scope = useLoad(async () => {
    const [meetings, tasks] = await Promise.all([api.get<MeetingSummary[]>('/api/meetings'), api.get<Task[]>('/api/tasks')])
    return { meetings, tasks }
  })
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [useLlm, setUseLlm] = useState(true)
  const end = useRef<HTMLDivElement>(null)
  const busy = turns.some(t => t.state === 'pending')
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [turns])

  async function run(id: number, question: string, llm: boolean) {
    const started = performance.now()
    const patch = (p: Partial<Turn>) => setTurns(ts => ts.map(t => (t.id === id ? { ...t, ...p } : t)))
    patch({ state: 'pending', error: undefined, started, early: undefined, earlyMs: undefined, ms: undefined })
    // Retrieval is fast; show its passages while the model writes. Purely informational:
    // the final answer always replaces them with its own citations.
    if (llm) api.get<Passage[]>(`/api/memory/search?q=${encodeURIComponent(question)}`)
      .then(early => setTurns(ts => ts.map(t => (t.id === id && t.state === 'pending' ? { ...t, early, earlyMs: performance.now() - started } : t))))
      .catch(() => {})
    try {
      const res = await api.post<Answer>('/api/memory/query', { question, use_llm: llm })
      patch({ state: 'done', res, ms: performance.now() - started })
    } catch (e) { patch({ state: 'error', error: errText(e), ms: undefined }) }
  }
  function ask(question: string) {
    if (question.length < 2 || busy) return
    const id = Date.now()
    setTurns(ts => [...ts, { id, question, useLlm, state: 'pending', started: performance.now() }])
    setQ('')
    void run(id, question, useLlm)
  }
  const send = (e?: FormEvent) => { e?.preventDefault(); ask(q.trim()) }
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  const nMeet = scope.data?.meetings.length ?? 0
  const nSeg = scope.data?.meetings.reduce((n, m) => n + m.segments, 0) ?? 0
  const ideas = scope.data ? suggestions(scope.data.tasks, scope.data.meetings) : []

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="Ask AI" sub="Ask anything about your meetings." />
      <div className="max-w-[760px] flex-1 space-y-6" aria-live="polite">
        {!turns.length && (
          <div className="space-y-4">
            <p className="max-w-[64ch] text-[14px] text-slate">Owners, deadlines and what is pending come straight from the approved task board, in milliseconds. Deeper questions are answered from transcripts and decisions, with every source shown. If nothing stored supports an answer, you are told so instead of getting a guess.</p>
            {ideas.length > 0 && (
              <div>
                <h2 className="mb-2 text-[13px] font-semibold text-slate">Try asking</h2>
                <ul className="flex flex-wrap gap-2">{ideas.map(s => (
                  <li key={s}><button type="button" onClick={() => ask(s)} className="rounded-full border border-rule-strong bg-panel px-3 py-1.5 text-left text-[13.5px] text-ink hover:border-accent hover:text-accent">{s}</button></li>))}
                </ul>
              </div>
            )}
          </div>
        )}
        {turns.map(t => (
          <div key={t.id} className="space-y-3">
            <div className="flex justify-end"><p className="max-w-[85%] rounded-lg bg-accent-soft px-3.5 py-2 text-ink">{t.question}</p></div>
            <div className="border-l-2 border-rule pl-4">
              <Reply t={t} retry={() => run(t.id, t.question, t.useLlm)} pick={code => ask(`${t.question.replace(/\?*\s*$/, '')} (${code})?`)} />
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="sticky bottom-3 mt-6 max-w-[760px] rounded-xl border border-rule-strong bg-panel p-2.5 shadow-pop focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        <div className="flex items-end gap-2">
          <textarea aria-label="Question" rows={2} className="min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none" /* the form shows the focus ring */
            placeholder="Who owns the regression tests, and when are they due?" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} />
          <Button kind="primary" type="submit" aria-label="Ask" className="h-9 w-9 rounded-lg px-0" disabled={q.trim().length < 2 || busy} loading={busy} icon={busy ? undefined : <ArrowUp size={16} />} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-rule px-1 pt-2">
          <label className="flex items-center gap-2 text-[13px] text-slate"><input type="checkbox" className="accent-[var(--accent)]" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />Write an answer with the model</label>
          <span className="text-[12.5px] text-faint">{scope.data ? `Searches ${nMeet} meeting${nMeet === 1 ? '' : 's'} (${nSeg} transcript segments), decisions and tasks.` : ''}</span>
        </div>
      </form>
    </div>
  )
}
