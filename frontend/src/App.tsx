import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  Activity, CalendarClock, ClipboardCheck, KanbanSquare, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Plus,
  Search, Sun, X,
} from 'lucide-react'
import { api, ApiError, getToken, setToken } from './lib/api'
import { Button, Field, ToastProvider, inputCls } from './components/ui'
import Inbox from './pages/Inbox'
import NewMeeting from './pages/NewMeeting'
import MeetingPage from './pages/MeetingPage'
import ReviewPage from './pages/ReviewPage'
import TasksPage from './pages/TasksPage'
import FollowUpPage from './pages/FollowUpPage'
import MemoryPage from './pages/MemoryPage'
import AgendaPage from './pages/AgendaPage'
import DiagnosticsPage from './pages/DiagnosticsPage'

const THEME_KEY = 'ps53.theme'
function readTheme(): 'dark' | 'light' {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode */ }
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 11h14M9 16h8M9 21h5" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="m18.5 21 2.4 2.4L25.5 18.8" stroke="var(--on-accent)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    setToken(value.trim())
    try { await api.get('/api/meetings'); onDone() } catch (err) {
      setToken(null)
      setError(err instanceof ApiError ? err.message : String(err))
    } finally { setBusy(false) }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="anim-in w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3"><Mark size={34} /><div><div className="text-[17px] font-semibold">Meeting actions</div><div className="text-[13px] text-faint">Organiser workspace</div></div></div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Sign in</h1>
        <p className="mt-1.5 text-[14px] text-slate">Turn what was agreed in meetings into reviewed, tracked tasks. Use the organiser token from this server’s <code className="rounded bg-panel-3 px-1 text-[13px]">.env</code> file.</p>
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-rule bg-panel p-5 shadow-soft">
          <Field label="Organiser token" hint="Kept only in this browser tab. Closing the tab signs you out.">
            <input type="password" autoComplete="current-password" required className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-[13.5px] text-cancel">{error}</p>}
          <Button kind="primary" type="submit" className="w-full" loading={busy} disabled={!value.trim()}>{busy ? 'Checking…' : 'Sign in'}</Button>
        </form>
        <p className="mt-4 text-[12.5px] text-faint">Local single-organiser mode. Every API call is checked against the token on the server.</p>
      </div>
    </main>
  )
}

interface Counts { reviews: number; openTasks: number }
interface Runtime { llm: string | null; stt: string | null }

function useShellData() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const loc = useLocation()
  useEffect(() => {
    let alive = true
    Promise.all([api.get<{ state: string }[]>('/api/changesets'), api.get<{ status: string }[]>('/api/tasks')])
      .then(([cs, tasks]) => alive && setCounts({
        reviews: cs.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)).length,
        openTasks: tasks.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).length,
      })).catch(() => {})
    return () => { alive = false }
  }, [loc.pathname])
  useEffect(() => {
    api.get<{ llm: { active: { provider: string | null; model: string | null } }; speech: { active: string | null } }>('/api/diagnostics')
      .then(d => setRuntime({ llm: d.llm.active.provider ? `${d.llm.active.provider} · ${d.llm.active.model}` : null,
        stt: d.speech.active === 'whisper' ? 'local Whisper' : d.speech.active === 'sarvam' ? 'Sarvam saaras:v4' : null }))
      .catch(() => setRuntime(null))
  }, [])
  return { counts, runtime }
}

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean; count?: keyof Counts }[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/review', label: 'Review changes', icon: <ClipboardCheck size={17} />, count: 'reviews' },
  { to: '/tasks', label: 'Task board', icon: <KanbanSquare size={17} />, count: 'openTasks' },
  { to: '/follow-up', label: 'Calendar & reminders', icon: <CalendarClock size={17} /> },
  { to: '/agenda', label: 'Next agenda', icon: <ListChecks size={17} /> },
  { to: '/memory', label: 'Ask past meetings', icon: <Search size={17} /> },
  { to: '/diagnostics', label: 'Diagnostics', icon: <Activity size={17} /> },
]

function NavItems({ counts, onNavigate }: { counts: Counts | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}
          className={({ isActive }) => `flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors ${isActive ? 'bg-panel-3 font-medium text-ink' : 'text-slate hover:bg-panel-2 hover:text-ink'}`}>
          {({ isActive }) => (<>
            <span className={isActive ? 'text-accent' : 'text-faint'}>{n.icon}</span>
            <span className="flex-1 truncate">{n.label}</span>
            {n.count && counts && counts[n.count] > 0 && <>
              <span aria-hidden className="tnum rounded bg-panel-3 px-1.5 text-[12px] text-slate">{counts[n.count]}</span>
              <span className="sr-only">, {counts[n.count]} {n.count === 'reviews' ? 'pending' : 'open'}</span></>}
          </>)}
        </NavLink>
      ))}
    </nav>
  )
}

function Shell() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(readTheme())
  const { counts, runtime } = useShellData()
  useEffect(() => applyTheme(theme), [theme])
  const footer = (
    <div className="space-y-3 border-t border-rule px-3 pt-3">
      <div className="space-y-1 text-[12px] text-faint">
        <div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${runtime?.llm ? 'bg-done' : 'bg-cancel'}`} />Model: <span className="truncate text-slate">{runtime?.llm ?? 'none available'}</span></div>
        <div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${runtime?.stt ? 'bg-done' : 'bg-ask'}`} />Speech: <span className="truncate text-slate">{runtime?.stt ?? 'transcripts only'}</span></div>
      </div>
      <div className="flex items-center gap-1">
        <Button kind="ghost" size="sm" icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </Button>
        <Button kind="ghost" size="sm" icon={<LogOut size={15} />} onClick={() => { setToken(null); location.reload() }}>Sign out</Button>
      </div>
    </div>
  )
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden border-r border-rule bg-panel lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:pb-3">
        <Link to="/" className="flex items-center gap-2.5 px-4 pb-4 pt-4"><Mark /><div className="min-w-0"><div className="text-[15px] font-semibold leading-tight">Meeting actions</div><div className="text-[12px] text-faint">Organiser workspace</div></div></Link>
        <div className="px-3 pb-3"><Link to="/meetings/new" className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"><Plus size={16} />New meeting</Link></div>
        <div className="scroll-quiet flex-1 overflow-y-auto px-2"><NavItems counts={counts} /></div>
        {footer}
      </aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-panel/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2"><Mark size={24} /><span className="text-[15px] font-semibold">Meeting actions</span></Link>
        <div className="flex items-center gap-2">
          <Link to="/meetings/new" aria-label="New meeting" className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-on-accent"><Plus size={17} /></Link>
          <Button kind="secondary" size="sm" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={16} /> : <Menu size={16} />}</Button>
        </div>
      </div>
      {open && (
        <div className="anim-in fixed inset-x-0 top-[53px] z-30 border-b border-rule bg-panel px-3 pb-3 pt-2 shadow-soft lg:hidden">
          <NavItems counts={counts} onNavigate={() => setOpen(false)} />
          <div className="mt-2">{footer}</div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1320px]">
          <Routes>
            <Route path="/" element={<Inbox />} />
            <Route path="/meetings/new" element={<NewMeeting />} />
            <Route path="/meetings/:id" element={<MeetingPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:meetingId" element={<ReviewPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/follow-up" element={<FollowUpPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  useEffect(() => applyTheme(readTheme()), [])
  useEffect(() => {
    const h = () => { setToken(null); setAuthed(false) }
    window.addEventListener('ps53:unauthorized', h)
    return () => window.removeEventListener('ps53:unauthorized', h)
  }, [])
  return (
    <BrowserRouter>
      {/* Inside the router: toasts may contain links. */}
      <ToastProvider>{authed ? <Shell /> : <SignIn onDone={() => setAuthed(true)} />}</ToastProvider>
    </BrowserRouter>
  )
}
