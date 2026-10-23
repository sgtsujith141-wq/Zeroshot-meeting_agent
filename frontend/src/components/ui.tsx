import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Inbox as InboxIcon, Loader2, RotateCcw, X, XCircle } from 'lucide-react'
import { ApiError, fmtTime } from '../lib/api'

// ---- data loading --------------------------------------------------------------------

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

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e))

// ---- layout primitives -----------------------------------------------------------------

export function PageHeader({ title, children, sub, meta }: { title: ReactNode; sub?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[22rem]">
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.018em] text-ink">{title}</h1>
        {sub && <div className="mt-1.5 max-w-[72ch] text-[14.5px] text-slate">{sub}</div>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

export function Panel({ title, children, actions, className = '', flush = false, icon }: {
  title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; flush?: boolean; icon?: ReactNode
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-rule bg-panel shadow-soft ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">{icon && <span className="text-faint">{icon}</span>}{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  )
}

export function SectionTitle({ children, count, aside }: { children: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[15.5px] font-semibold text-ink">{children}{count != null && <span className="ml-2 font-normal text-faint tnum">{count}</span>}</h2>
      {aside}
    </div>
  )
}

// ---- states ------------------------------------------------------------------------------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

export function Loading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 py-2">
      <Skeleton className="h-6 w-56" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="anim-in mb-4 flex items-start justify-between gap-4 rounded-lg border border-cancel/35 bg-cancel-soft px-4 py-3 text-[14px] text-ink">
      <span className="flex items-start gap-2.5"><XCircle size={17} className="mt-0.5 shrink-0 text-cancel" />{error}</span>
      {onRetry && <Button size="sm" kind="ghost" icon={<RotateCcw size={14} />} onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rule-strong px-6 py-10 text-center text-[14px] text-slate">
      <span className="text-faint">{icon ?? <InboxIcon size={22} />}</span>
      <div className="max-w-[48ch]">{children}</div>
      {action}
    </div>
  )
}

export function Notice({ tone = 'ask', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[14px] ${noticeCls[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle size={16} />}</span><div className="min-w-0 text-ink">{children}</div>
    </div>
  )
}

// ---- chips & status ------------------------------------------------------------------------

export type Tone = 'create' | 'update' | 'ask' | 'cancel' | 'done' | 'violet' | 'neutral'
const toneCls: Record<Tone, string> = {
  create: 'bg-create-soft text-create', update: 'bg-sky-soft text-sky', ask: 'bg-ask-soft text-ask',
  cancel: 'bg-cancel-soft text-cancel', done: 'bg-done-soft text-done', violet: 'bg-violet-soft text-violet',
  neutral: 'bg-panel-3 text-slate',
}
const noticeCls: Record<Tone, string> = {
  create: 'border-create/30 bg-create-soft text-create', update: 'border-sky/30 bg-sky-soft text-sky',
  ask: 'border-ask/30 bg-ask-soft text-ask', cancel: 'border-cancel/30 bg-cancel-soft text-cancel',
  done: 'border-done/30 bg-done-soft text-done', violet: 'border-violet/30 bg-violet-soft text-violet',
  neutral: 'border-rule bg-panel-2 text-slate',
}
export function Chip({ tone = 'neutral', children, title, icon }: { tone?: Tone; children: ReactNode; title?: string; icon?: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12.5px] font-medium leading-5 ${toneCls[tone]}`}>
      {icon}{children}
    </span>
  )
}

export function stateTone(state: string): Tone {
  if (['proposed', 'READY_FOR_REVIEW', 'scheduled', 'prepared'].includes(state)) return 'create'
  if (['APPLIED', 'done', 'delivered', 'sent', 'approved', 'completed', 'ready_for_review'].includes(state)) return 'done'
  if (['needs_clarification', 'held', 'NEEDS_CLARIFICATION', 'queued', 'transcribing', 'interpreting', 'writing_minutes', 'draft'].includes(state)) return 'ask'
  if (['cancelled', 'rejected', 'failed', 'FAILED', 'REJECTED', 'blocked'].includes(state)) return 'cancel'
  if (['in_progress', 'update'].includes(state)) return 'update'
  return 'neutral'
}

const STATE_LABEL: Record<string, string> = {
  proposed: 'Ready to approve', needs_clarification: 'Needs an answer', held: 'On hold until answered',
  tentative: 'Suggestion only', cancelled: 'Cancelled in meeting', rejected: 'Ruled out', excluded: 'Excluded by you',
  no_change: 'No change', completed: 'Reported done',
  NEEDS_CLARIFICATION: 'Questions open', READY_FOR_REVIEW: 'Ready for approval', APPLIED: 'Approved and applied',
  REJECTED: 'Rejected', FAILED: 'Apply failed', APPROVED: 'Approved', DRAFT: 'Draft',
  ready_for_review: 'Processed', failed: 'Failed', queued: 'Queued', transcribing: 'Transcribing',
  interpreting: 'Interpreting', writing_minutes: 'Writing minutes', transcribed: 'Transcript stored',
  uploaded: 'Uploaded', created: 'Waiting for upload',
  todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done',
  draft: 'Draft', scheduled: 'Scheduled', delivered: 'Delivered', prepared: 'Prepared', approved: 'Approved', sent: 'Sent',
}
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.replace(/_/g, ' ')

const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']
export function StateChip({ state }: { state: string }) {
  return <Chip tone={stateTone(state)} icon={BUSY.includes(state) ? <Loader2 size={12} className="anim-spin" /> : undefined}>{stateLabel(state)}</Chip>
}

export function Avatar({ name, size = 22 }: { name: string | null | undefined; size?: number }) {
  if (!name) return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-rule-strong text-faint" style={{ width: size, height: size, fontSize: size * 0.45 }}>?</span>
  const initials = name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 45% / 0.22)`, color: `hsl(${hue} 62% 62%)` }}>
      {initials}
    </span>
  )
}

export function Spinner({ size = 15 }: { size?: number }) {
  return <Loader2 size={size} className="anim-spin" aria-hidden />
}

// ---- controls ----------------------------------------------------------------------------------

type BtnKind = 'primary' | 'secondary' | 'danger' | 'quiet' | 'ghost'
export function Button({ kind = 'secondary', size = 'md', icon, loading, className = '', children, disabled, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean }) {
  const k = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-panel-3 disabled:text-faint',
    secondary: 'border border-rule-strong bg-panel-2 text-ink hover:bg-panel-3 disabled:text-faint disabled:hover:bg-panel-2',
    danger: 'border border-cancel/35 bg-transparent text-cancel hover:bg-cancel-soft disabled:opacity-50',
    ghost: 'text-slate hover:bg-panel-3 hover:text-ink disabled:text-faint',
    quiet: 'text-sky hover:underline underline-offset-2 disabled:text-faint',
  }[kind]
  const s = kind === 'quiet' ? 'h-auto px-0' : size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-[13.5px]'
  return (
    <button {...props} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed ${s} ${k} ${className}`}>
      {loading ? <Spinner size={14} /> : icon}{children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12.5px] text-faint">{hint}</span>}
    </label>
  )
}
export const inputCls = 'h-9 w-full rounded-md border border-rule-strong bg-panel-2 px-2.5 text-[14px] text-ink placeholder:text-faint transition-colors focus:border-sky focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-sky/25'

// ---- evidence -------------------------------------------------------------------------------------

export interface SegLike { speaker_label: string; start_seconds: number; end_seconds?: number | null; text: string }

export function SegmentChip({ segKey, seg, name, onClick, to }: { segKey: string; seg?: SegLike; name?: string | null; onClick?: () => void; to?: string }) {
  const who = name || seg?.speaker_label
  const body = <><span className="text-faint">{segKey}</span>{seg && <><span className="text-ink">{who}</span><span className="tnum text-faint">{fmtTime(seg.start_seconds)}</span></>}</>
  const cls = 'inline-flex items-center gap-1.5 rounded-md border border-rule bg-panel-2 px-1.5 py-0.5 text-[12px] leading-5 transition-colors hover:border-sky/50 hover:bg-sky-soft'
  if (!seg) return <span className={`${cls} text-cancel`}>{segKey} missing</span>
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-label={`Show segment ${segKey} in transcript`}>{body}</button>
  if (to) return <Link className={cls} to={to}>{body}</Link>
  return <span className={cls}>{body}</span>
}

export function Quote({ segKey, seg, speakerName, meetingId, onFocus, compact }: {
  segKey: string; seg?: SegLike; speakerName?: string | null; meetingId?: number; onFocus?: (k: string) => void; compact?: boolean
}) {
  if (!seg) return <div className="text-[13px] text-cancel">Evidence {segKey} not found in this meeting</div>
  const who = speakerName && speakerName !== seg.speaker_label ? `${speakerName} (${seg.speaker_label})` : seg.speaker_label
  return (
    <figure className="border-l-2 border-rule-strong pl-3">
      <blockquote className={`spoken text-ink ${compact ? 'line-clamp-2' : ''}`}>“{seg.text}”</blockquote>
      <figcaption className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
        {onFocus ? <button type="button" className="hover:text-sky" onClick={() => onFocus(segKey)}>{who}, <span className="tnum">{fmtTime(seg.start_seconds)}</span></button>
          : meetingId ? <Link className="hover:text-sky" to={`/meetings/${meetingId}#${segKey}`}>{who}, <span className="tnum">{fmtTime(seg.start_seconds)}</span></Link>
          : <span>{who}, <span className="tnum">{fmtTime(seg.start_seconds)}</span></span>}
        <span>segment {segKey}</span>
      </figcaption>
    </figure>
  )
}

// ---- overlays -------------------------------------------------------------------------------------

function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', h)
    const t = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, textarea, select')
      ;(first ?? ref.current)?.focus()
    }, 10)
    return () => { document.removeEventListener('keydown', h); clearTimeout(t); prev?.focus?.() }
  }, [open])
  return ref
}

export function Dialog({ open, onClose, title, children, footer, width = 460 }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number
}) {
  const ref = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className="anim-in w-full rounded-xl border border-rule-strong bg-panel shadow-soft outline-none" style={{ maxWidth: width }} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button kind="ghost" size="sm" aria-label="Close" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className="px-4 py-4 text-[14px]">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-4 py-3">{footer}</div>}
      </div>
    </div>, document.body)
}

export function Drawer({ open, onClose, title, sub, children, width = 560 }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; width?: number
}) {
  const ref = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}
        className="anim-drawer flex h-full w-full flex-col border-l border-rule-strong bg-panel outline-none" style={{ maxWidth: width }} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">{sub && <div className="mb-0.5 text-[12.5px] text-faint">{sub}</div>}<h2 className="text-[18px] font-semibold leading-snug">{title}</h2></div>
          <Button kind="ghost" size="sm" aria-label="Close" onClick={onClose}><X size={17} /></Button>
        </div>
        <div className="scroll-quiet flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>, document.body)
}

// ---- toasts -------------------------------------------------------------------------------------------

interface Toast { id: number; tone: 'ok' | 'error' | 'info'; text: ReactNode }
const ToastCtx = createContext<(tone: Toast['tone'], text: ReactNode) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: ReactNode) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, tone, text }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 8000 : 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} role="status" className="anim-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-rule-strong bg-panel-2 px-3.5 py-3 text-[14px] shadow-soft">
            {t.tone === 'ok' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-done" /> : t.tone === 'error' ? <XCircle size={17} className="mt-0.5 shrink-0 text-cancel" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0 text-ask" />}
            <div className="min-w-0 flex-1">{t.text}</div>
            <button className="text-faint hover:text-ink" aria-label="Dismiss" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
