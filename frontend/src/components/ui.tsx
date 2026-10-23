import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Loader2, MoreHorizontal, RotateCcw, TriangleAlert, X, XCircle } from 'lucide-react'
import { ApiError, fmtTime } from '../lib/api'

// ---- data loading --------------------------------------------------------------------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number | ((d: T | null) => number | undefined)) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loads, setLoads] = useState(0) // completed loads, successful or not
  const fnRef = useRef(fn)
  fnRef.current = fn
  const pollRef = useRef(pollMs)
  pollRef.current = pollMs
  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d); setError(null)
      return d
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      return null
    } finally { setLoading(false); setLoads(n => n + 1) }
  }, [])
  useEffect(() => {
    setLoading(true)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  // Polling is re-armed after every load, including manual reloads and failed requests, so a
  // page that starts work (e.g. "Re-run analysis") keeps refreshing until the work is done.
  useEffect(() => {
    const p = pollRef.current
    const ms = typeof p === 'function' ? p(data) : p
    if (!ms) return
    const t = setTimeout(() => { void reload() }, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads])
  return { data, error, loading, reload, setData }
}

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e))
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---- page structure ------------------------------------------------------------------------

export interface Crumb { label: string; to: string }

export function PageHeader({ title, sub, meta, actions, crumbs }: {
  title: ReactNode; sub?: ReactNode; meta?: ReactNode; actions?: ReactNode; crumbs?: Crumb[]
}) {
  return (
    <header className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex min-w-0 items-center gap-1 text-[13px] text-faint">
          {crumbs.map(c => (
            <span key={c.to} className="flex shrink-0 items-center gap-1">
              <Link to={c.to} className="hover:text-ink">{c.label}</Link><ChevronRight size={13} aria-hidden />
            </span>
          ))}
          <span className="min-w-0 truncate" aria-current="page">{typeof title === 'string' ? title : ''}</span>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[20rem]">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.012em] text-ink">{title}</h1>
          {sub && <div className="mt-1 max-w-[70ch] text-[14px] text-slate">{sub}</div>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** A titled group of content. No box: a heading, an optional count, actions on the right. */
export function Section({ title, count, actions, children, className = '', id }: {
  title: ReactNode; count?: number; actions?: ReactNode; children: ReactNode; className?: string; id?: string
}) {
  const auto = useId()
  id = id ?? `s${auto.replace(/:/g, '')}`
  return (
    <section className={`min-w-0 ${className}`} aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}{count != null && <span className="ml-2 font-normal text-faint tnum">{count}</span>}</h2>
        {actions && <div className="flex items-center gap-3 text-[13px]">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** A white list container with hairline rows; rows are usually links. */
export function ListBox({ children, empty, label }: { children: ReactNode[]; empty: ReactNode; label?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-panel">
      {children.length ? <ul aria-label={label} className="divide-y divide-rule">{children}</ul>
        : <p className="px-4 py-3.5 text-[13.5px] text-faint">{empty}</p>}
    </div>
  )
}

/** Marks data that was made up for testing or demonstration. */
export function SyntheticTag() {
  return <span title="Synthetic test data, not a real meeting" className="shrink-0 rounded border border-rule-strong px-1 text-[10.5px] font-semibold leading-[16px] tracking-[0.06em] text-slate">SYNTHETIC</span>
}

// ---- states ----------------------------------------------------------------------------------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

export function Loading({ label = 'Loading', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 py-2">
      <Skeleton className="mb-4 h-6 w-52" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-md border border-cancel/40 px-3.5 py-2.5 text-[14px] text-ink">
      <span className="flex items-start gap-2"><XCircle size={16} className="mt-0.5 shrink-0 text-cancel" />{error}</span>
      {onRetry && <Button size="sm" kind="ghost" icon={<RotateCcw size={13} />} onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-6 text-[14px] text-slate">
      <p className="max-w-[60ch]">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export type Tone = 'accent' | 'sky' | 'violet' | 'ask' | 'cancel' | 'done' | 'neutral'
const TEXT: Record<Tone, string> = {
  accent: 'text-accent', sky: 'text-sky', violet: 'text-violet', ask: 'text-ask', cancel: 'text-cancel', done: 'text-done', neutral: 'text-slate',
}
const DOT: Record<Tone, string> = {
  accent: 'bg-accent', sky: 'bg-sky', violet: 'bg-violet', ask: 'bg-ask-dot', cancel: 'bg-cancel-dot', done: 'bg-done-dot', neutral: 'bg-rule-strong',
}
const BAR: Record<Tone, string> = {
  accent: 'border-l-accent', sky: 'border-l-sky', violet: 'border-l-violet', ask: 'border-l-ask', cancel: 'border-l-cancel', done: 'border-l-done', neutral: 'border-l-rule-strong',
}

/** One line of important information: a coloured left rule, a title, the details, actions. */
export function Notice({ tone = 'ask', title, children, actions, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className={`rounded-md border border-rule border-l-[3px] ${BAR[tone]} bg-panel px-3.5 py-2.5 text-[14px]`}>
      {title && <div className="font-medium text-ink">{title}</div>}
      {children && <div className={`${title ? 'mt-0.5' : ''} text-slate`}>{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Inline status: a small dot and a label. */
export function Status({ tone = 'neutral', children, busy }: { tone?: Tone; children: ReactNode; busy?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] ${TEXT[tone]}`}>
      {busy ? <Loader2 size={12} className="anim-spin" aria-hidden /> : <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="anim-spin" aria-hidden />
}

// ---- controls ----------------------------------------------------------------------------------

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
export function Button({ kind = 'secondary', size = 'md', icon, loading, className = '', children, disabled, ...props }:
  ComponentProps<'button'> & { kind?: BtnKind; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean }) {
  const k = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-panel-3 disabled:text-faint',
    secondary: 'border border-rule-strong bg-panel text-ink hover:bg-panel-2 disabled:text-faint disabled:hover:bg-panel',
    danger: 'border border-cancel/40 text-cancel hover:bg-cancel-soft disabled:opacity-50',
    ghost: 'text-slate hover:bg-panel-2 hover:text-ink disabled:text-faint disabled:hover:bg-transparent',
    link: 'text-sky underline-offset-2 hover:underline disabled:text-faint disabled:no-underline',
  }[kind]
  const s = kind === 'link' ? 'h-auto px-0' : size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-[13.5px]'
  return (
    <button type="button" {...props} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-100 disabled:cursor-not-allowed ${s} ${k} ${className}`}>
      {loading ? <Spinner size={13} /> : icon}{children}
    </button>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  const auto = useId()
  const id = htmlFor ?? auto
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">{label}</label>
      {/* The single child control receives the id so the label names exactly that control. */}
      {withId(children, id)}
      {hint && <p className="mt-1 text-[12.5px] text-faint">{hint}</p>}
    </div>
  )
}
function withId(node: ReactNode, id: string): ReactNode {
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ id?: string }>
  return el.props.id ? el : cloneElement(el, { id })
}
export const inputCls = 'h-8 w-full rounded-md border border-rule-strong bg-panel px-2.5 text-[14px] text-ink placeholder:text-faint focus:border-sky focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-sky/25'

/** Popover menu for secondary actions. Closes on Esc, outside click and selection. */
export function Menu({ label, items, align = 'right', icon, up, kind = 'secondary' }: {
  label: string; align?: 'left' | 'right'; icon?: ReactNode; up?: boolean; kind?: 'secondary' | 'ghost'
  items: ({ label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode } | null)[]
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    box.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const nav = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
    e.preventDefault()
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
  }
  return (
    <div ref={box} className="relative" onKeyDown={nav}>
      <Button ref={btn} kind={kind} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} icon={icon ?? <MoreHorizontal size={15} />}
        className={kind === 'ghost' ? 'w-full justify-start' : ''}>{label}</Button>
      {open && (
        <div role="menu" aria-label={label} className={`shadow-pop absolute z-40 min-w-[12rem] rounded-md border border-rule-strong bg-panel py-1 ${up ? 'bottom-full mb-1' : 'mt-1'} ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.filter(Boolean).map(it => (
            <button key={it!.label} type="button" role="menuitem" disabled={it!.disabled}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13.5px] hover:bg-panel-2 focus:bg-panel-2 focus:outline-none disabled:text-faint ${it!.danger ? 'text-cancel' : 'text-ink'}`}
              onClick={() => { setOpen(false); it!.onSelect() }}>{it!.icon && <span className="text-faint">{it!.icon}</span>}{it!.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Tabs with arrow-key navigation. */
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return
    const i = tabs.findIndex(t => t.key === value)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    onChange(next.key)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus())
  }
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={key} className="mb-4 flex flex-wrap gap-x-1 border-b border-rule">
      {tabs.map(t => (
        <button key={t.key} type="button" role="tab" data-tab={t.key} aria-selected={t.key === value} tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[13.5px] font-medium transition-colors ${t.key === value ? 'border-accent text-ink' : 'border-transparent text-slate hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---- evidence -------------------------------------------------------------------------------------

export interface SegLike { speaker_label: string; start_seconds: number; end_seconds?: number | null; text: string }

/** A reference to one transcript segment: speaker, time and key. Clicking shows it in the transcript. */
export function SegRef({ segKey, seg, name, onClick, to }: { segKey: string; seg?: SegLike; name?: string | null; onClick?: () => void; to?: string }) {
  if (!seg) return <span className="text-[12.5px] text-cancel">{segKey} missing</span>
  const who = name || seg.speaker_label
  const body = <>{who} <span className="tnum">{fmtTime(seg.start_seconds)}</span> <span className="text-faint">({segKey})</span></>
  const cls = 'whitespace-nowrap text-[12.5px] text-sky hover:underline underline-offset-2'
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-label={`Show ${segKey} in transcript`}>{body}</button>
  if (to) return <Link className={cls} to={to}>{body}</Link>
  return <span className="whitespace-nowrap text-[12.5px] text-slate">{body}</span>
}

export function Quote({ segKey, seg, name, onShow, to }: { segKey: string; seg?: SegLike; name?: string | null; onShow?: (k: string) => void; to?: string }) {
  if (!seg) return <p className="text-[13px] text-cancel">Segment {segKey} is not in this meeting.</p>
  return (
    <figure className="border-l-2 border-rule-strong pl-3">
      <blockquote className="spoken text-ink">“{seg.text}”</blockquote>
      <figcaption className="mt-0.5"><SegRef segKey={segKey} seg={seg} name={name} onClick={onShow ? () => onShow(segKey) : undefined} to={to} /></figcaption>
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
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() }
      if (e.key === 'Tab' && ref.current) { // keep focus inside the overlay
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', h)
    const t = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
      first?.focus()
    }, 10)
    return () => { document.removeEventListener('keydown', h); clearTimeout(t); prev?.focus?.() }
  }, [open])
  return ref
}

export function Dialog({ open, onClose, title, children, footer, width = 460 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number
}) {
  const ref = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="shadow-pop w-full rounded-lg border border-rule-strong bg-panel outline-none" style={{ maxWidth: width }} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button kind="ghost" size="sm" aria-label="Close" onClick={onClose}><X size={15} /></Button>
        </div>
        <div className="px-4 py-2 text-[14px]">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-4 pb-4 pt-2">{footer}</div>}
      </div>
    </div>, document.body)
}

export function Drawer({ open, onClose, title, sub, children, width = 560, footer }: {
  open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode
}) {
  const ref = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="flex h-full w-full flex-col border-l border-rule-strong bg-panel outline-none" style={{ maxWidth: width }} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">{sub && <div className="text-[12.5px] text-faint">{sub}</div>}<h2 className="text-[17px] font-semibold leading-snug">{title}</h2></div>
          <Button kind="ghost" size="sm" aria-label="Close" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className="scroll-quiet flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-rule px-5 py-3">{footer}</div>}
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
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 9000 : 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} role="status" className="shadow-pop pointer-events-auto flex items-start gap-2.5 rounded-md border border-rule-strong bg-panel px-3.5 py-2.5 text-[14px]">
            {t.tone === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-done" /> : t.tone === 'error' ? <XCircle size={16} className="mt-0.5 shrink-0 text-cancel" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0 text-ask" />}
            <div className="min-w-0 flex-1">{t.text}</div>
            <button className="text-faint hover:text-ink" aria-label="Dismiss" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
