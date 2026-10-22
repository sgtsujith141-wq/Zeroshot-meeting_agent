import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, fmtTime } from '../lib/api'

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number | ((d: T | null) => number | undefined)) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d); setError(null)
      return d
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      return null
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let alive = true
    const tick = async () => {
      const d = await reload()
      const ms = typeof pollMs === 'function' ? pollMs(d) : pollMs
      if (alive && ms) timer = setTimeout(tick, ms)
    }
    setLoading(true)
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload, setData }
}

export function PageHeader({ title, children, sub }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {sub && <div className="mt-1 max-w-[70ch] text-slate">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  )
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-md border border-cancel/30 bg-cancel-soft px-4 py-3 text-cancel">
      <span>{error}</span>
      {onRetry && <button className="shrink-0 font-medium underline" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-rule px-6 py-10 text-center text-slate">{children}</div>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="py-8 text-slate" aria-live="polite">{label}</p>
}

type Tone = 'create' | 'update' | 'ask' | 'cancel' | 'neutral'
const toneCls: Record<Tone, string> = {
  create: 'bg-create-soft text-create', update: 'bg-update-soft text-update', ask: 'bg-ask-soft text-ask',
  cancel: 'bg-cancel-soft text-cancel', neutral: 'bg-paper text-slate border border-rule',
}
export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[12.5px] font-medium ${toneCls[tone]}`}>{children}</span>
}

export function stateTone(state: string): Tone {
  if (['proposed', 'APPLIED', 'READY_FOR_REVIEW', 'ready_for_review', 'done', 'delivered', 'sent', 'approved'].includes(state)) return 'create'
  if (['needs_clarification', 'held', 'NEEDS_CLARIFICATION', 'queued', 'transcribing', 'interpreting', 'writing_minutes', 'draft', 'prepared'].includes(state)) return 'ask'
  if (['cancelled', 'rejected', 'failed', 'FAILED', 'REJECTED', 'blocked'].includes(state)) return 'cancel'
  if (['in_progress', 'update', 'scheduled'].includes(state)) return 'update'
  return 'neutral'
}

const STATE_LABEL: Record<string, string> = {
  proposed: 'Ready to approve', needs_clarification: 'Needs an answer', held: 'On hold until answered',
  tentative: 'Suggestion only', cancelled: 'Cancelled in meeting', rejected: 'Ruled out', excluded: 'Excluded by you',
  no_change: 'No change', completed: 'Reported done',
  NEEDS_CLARIFICATION: 'Questions open', READY_FOR_REVIEW: 'Ready for approval', APPLIED: 'Approved and applied',
  REJECTED: 'Rejected', FAILED: 'Apply failed', APPROVED: 'Approved', DRAFT: 'Draft',
  ready_for_review: 'Ready for review', failed: 'Failed', queued: 'Queued', transcribing: 'Transcribing',
  interpreting: 'Interpreting', writing_minutes: 'Writing minutes', transcribed: 'Transcript stored',
  uploaded: 'Uploaded', created: 'Waiting for upload',
  todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done',
}
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.replace(/_/g, ' ')

export function StateChip({ state }: { state: string }) {
  return <Chip tone={stateTone(state)}>{stateLabel(state)}</Chip>
}

export function Button({ kind = 'secondary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  const k = {
    primary: 'bg-create text-white hover:bg-[#0b5a5a] disabled:bg-slate/40',
    secondary: 'border border-rule bg-panel text-ink hover:border-slate/60 disabled:text-slate/60',
    danger: 'border border-cancel/40 bg-panel text-cancel hover:bg-cancel-soft',
    quiet: 'text-update hover:underline disabled:text-slate/60',
  }[kind]
  return <button {...props} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed ${k} ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-slate">{hint}</span>}
    </label>
  )
}
export const inputCls = 'w-full rounded-md border border-rule bg-panel px-2.5 py-1.5 text-[14.5px] placeholder:text-slate/70 focus:border-update'

export interface SegLike { speaker_label: string; start_seconds: number; end_seconds?: number | null; text: string }

export function Quote({ segKey, seg, speakerName, meetingId }: { segKey: string; seg?: SegLike; speakerName?: string | null; meetingId?: number }) {
  if (!seg) return <div className="text-[13px] text-cancel">Evidence {segKey} not found in this meeting</div>
  const who = speakerName && speakerName !== seg.speaker_label ? `${speakerName} (${seg.speaker_label})` : seg.speaker_label
  return (
    <figure className="border-l-2 border-rule pl-3">
      <blockquote className="spoken text-ink">“{seg.text}”</blockquote>
      <figcaption className="mt-0.5 text-[12.5px] text-slate">
        {meetingId ? <Link className="hover:underline" to={`/meetings/${meetingId}#${segKey}`}>{who}, {fmtTime(seg.start_seconds)}</Link> : <>{who}, {fmtTime(seg.start_seconds)}</>}
        <span className="ml-1.5 text-slate/70">segment {segKey}</span>
      </figcaption>
    </figure>
  )
}

export function Panel({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[10px] border border-rule bg-panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
