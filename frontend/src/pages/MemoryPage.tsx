import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtTime } from '../lib/api'
import type { Passage } from '../types'
import { Button, ErrorBox, PageHeader, Panel, StateChip, inputCls } from '../components/ui'

interface Answer {
  question: string; answer: string; found: boolean; mode: string; citations: Passage[]; passages: Passage[]
  current_state: { code: string; title: string; owner: string | null; status: string; due_date: string | null; revision: number }[]
  llm?: { provider: string; model: string }; llm_error?: string; note?: string
}

const MODE: Record<string, string> = {
  llm_grounded: 'Answer written by the model from the cited passages only',
  extractive: 'No model answer; showing the closest stored passages',
  retrieval: 'Search only',
}

export default function MemoryPage() {
  const [q, setQ] = useState('')
  const [useLlm, setUseLlm] = useState(true)
  const [res, setRes] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function ask(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { setRes(await api.post<Answer>('/api/memory/query', { question: q, use_llm: useLlm })) }
    catch (x) { setErr(x instanceof ApiError ? x.message : String(x)) } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Ask past meetings" sub="Answers come only from stored transcripts, approved decisions and the current task board, with the source shown for each." />
      <form onSubmit={ask} className="mb-6 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xl flex-1`} aria-label="Question" placeholder="Who owns the regression tests, and when are they due?" value={q} onChange={e => setQ(e.target.value)} minLength={2} required />
        <Button kind="primary" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Ask'}</Button>
        <label className="flex items-center gap-1.5 text-[14px] text-slate"><input type="checkbox" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />Write an answer with the model</label>
      </form>
      <ErrorBox error={err} />
      {res && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel title="Answer">
            <p className={`text-[16px] ${res.found ? '' : 'text-slate'}`}>{res.answer}</p>
            <p className="mt-2 text-[12.5px] text-slate">{MODE[res.mode] ?? res.mode}{res.llm && ` (${res.llm.provider}/${res.llm.model})`}.{res.llm_error && ` Model unavailable: ${res.llm_error}`}{res.note && ` ${res.note}.`}</p>
            {res.citations.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 font-semibold">What was originally said or recorded</h3>
                <ul className="space-y-3">{res.citations.map(p => (
                  <li key={p.passage_id} className="border-l-2 border-rule pl-3">
                    <p className={p.doc_type === 'segment' ? 'spoken' : ''}>{p.doc_type === 'segment' ? `“${p.text}”` : p.text}</p>
                    <div className="text-[12.5px] text-slate">
                      {p.passage_id}, {p.doc_type === 'segment' ? 'transcript' : p.doc_type}{p.meeting_id && <>, <Link className="text-update hover:underline" to={`/meetings/${p.meeting_id}${p.seg_key ? `#${p.seg_key}` : ''}`}>{p.meeting_title}</Link> ({fmtDate(p.meeting_date)})</>}
                      {p.speaker && `, ${p.speaker} at ${fmtTime(p.start_seconds)}`}
                    </div>
                  </li>))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title="Current approved state">
            {!res.current_state.length ? <p className="text-slate">No approved task is linked to these passages.</p> : (
              <ul className="space-y-2">{res.current_state.map(t => (
                <li key={t.code}><span className="text-slate">{t.code}</span> <span className="font-medium">{t.title}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[14px]"><StateChip state={t.status} /> {t.owner ?? 'unassigned'}, due {fmtDate(t.due_date)}, revision {t.revision}</div>
                </li>))}
              </ul>
            )}
            <p className="mt-3 text-[12.5px] text-slate">This can differ from what was said if a later meeting changed the task.</p>
          </Panel>
        </div>
      )}
    </>
  )
}
