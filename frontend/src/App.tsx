import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CalendarClock, ClipboardCheck, FileAudio, LayoutGrid, ListTodo, Menu as MenuIcon, MessageSquareText, X } from 'lucide-react'
import { api, ApiError, getToken, setToken } from './lib/api'
import { Button, Field, Menu, Notice, ToastProvider, inputCls } from './components/ui'
import { OPEN_TASK } from './lib/status'
import Overview from './pages/Overview'
import MeetingsPage from './pages/MeetingsPage'
import NewMeeting from './pages/NewMeeting'
import MeetingPage from './pages/MeetingPage'
import ApprovalsPage from './pages/ApprovalsPage'
import TasksPage from './pages/TasksPage'
import AskPage from './pages/AskPage'
import FollowUpsPage from './pages/FollowUpsPage'
import DiagnosticsPage from './pages/DiagnosticsPage'

const THEME_KEY = 'ps53.theme'
function readTheme(): 'dark' | 'light' {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode */ }
}

function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M9 11h14M9 16h8M9 21h5" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="m18.5 21 2.4 2.4L25.5 18.8" stroke="var(--on-accent)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SignIn({ onDone, notice }: { onDone: () => void; notice: string | null }) {
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
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5"><Mark size={28} /><span className="text-[16px] font-semibold">Meeting actions</span></div>
        <h1 className="text-[20px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[14px] text-slate">Use the organiser token from this server’s <code className="rounded bg-panel-3 px-1 text-[13px]">.env</code> file.</p>
        {notice && <div className="mt-4"><Notice tone="ask" role="status" title="You were signed out">{notice}</Notice></div>}
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="Organiser token" hint="Kept only in this browser tab.">
            <input type="password" autoComplete="current-password" required className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-[13.5px] text-cancel">{error}</p>}
          <Button kind="primary" type="submit" className="w-full" loading={busy} disabled={!value.trim()}>{busy ? 'Checking…' : 'Sign in'}</Button>
        </form>
      </div>
    </main>
  )
}

interface Counts { approvals: number; openTasks: number }

function useCounts() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const loc = useLocation()
  useEffect(() => {
    let alive = true
    Promise.all([api.get<{ state: string }[]>('/api/changesets'), api.get<{ status: string }[]>('/api/tasks')])
      .then(([cs, tasks]) => alive && setCounts({
        approvals: cs.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)).length,
        openTasks: tasks.filter(t => OPEN_TASK.includes(t.status)).length,
      })).catch(() => {})
    return () => { alive = false }
  }, [loc.pathname, loc.search])
  return counts
}

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean; count?: keyof Counts; countLabel?: string }[] = [
  { to: '/', label: 'Overview', icon: <LayoutGrid size={16} />, end: true },
  { to: '/meetings', label: 'Meetings', icon: <FileAudio size={16} /> },
  { to: '/approvals', label: 'Approvals', icon: <ClipboardCheck size={16} />, count: 'approvals', countLabel: 'waiting' },
  { to: '/tasks', label: 'Tasks', icon: <ListTodo size={16} />, count: 'openTasks', countLabel: 'open' },
  { to: '/ask', label: 'Ask AI', icon: <MessageSquareText size={16} /> },
  { to: '/follow-ups', label: 'Follow-ups', icon: <CalendarClock size={16} /> },
]

function NavItems({ counts, onNavigate }: { counts: Counts | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-px">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}
          className={({ isActive }) => `flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors ${isActive ? 'bg-panel-3 font-medium text-ink' : 'text-slate hover:bg-panel-2 hover:text-ink'}`}>
          <span className="text-faint">{n.icon}</span>
          <span className="flex-1">{n.label}</span>
          {n.count && counts && counts[n.count] > 0 && <span className="tnum text-[12.5px] text-faint">{counts[n.count]}<span className="sr-only"> {n.countLabel}</span></span>}
        </NavLink>
      ))}
    </nav>
  )
}

function Shell() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(readTheme())
  const counts = useCounts()
  const nav = useNavigate()
  useEffect(() => applyTheme(theme), [theme])
  const signOut = () => { setToken(null); location.assign('/') }
  const more = [
    { label: 'Diagnostics', onSelect: () => { setOpen(false); nav('/diagnostics') } },
    { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { label: 'Sign out', onSelect: signOut },
  ]
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
      <aside className="hidden border-r border-rule lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:px-3 lg:py-4">
        <Link to="/" className="mb-5 flex items-center gap-2 px-2.5"><Mark /><span className="text-[15px] font-semibold">Meeting actions</span></Link>
        <div className="flex-1"><NavItems counts={counts} /></div>
        <div className="px-1"><Menu label="More" align="left" items={more} /></div>
      </aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-paper px-4 py-2 lg:hidden">
        <Link to="/" className="flex items-center gap-2"><Mark size={22} /><span className="text-[15px] font-semibold">Meeting actions</span></Link>
        <Button kind="secondary" size="sm" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)} icon={open ? <X size={15} /> : <MenuIcon size={15} />} />
      </div>
      {open && (
        <div className="fixed inset-x-0 top-[49px] z-30 border-b border-rule bg-paper px-3 pb-3 pt-2 lg:hidden">
          <NavItems counts={counts} onNavigate={() => setOpen(false)} />
          <div className="mt-2 space-y-px border-t border-rule pt-2">
            {more.map(m => <button key={m.label} type="button" onClick={() => { setOpen(false); m.onSelect() }} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[14px] text-slate hover:bg-panel-2 hover:text-ink">{m.label}</button>)}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1200px]">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/meetings/new" element={<NewMeeting />} />
            <Route path="/meetings/:id" element={<MeetingPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/approvals/:meetingId" element={<ApprovalsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/follow-ups" element={<FollowUpsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            {/* Earlier addresses keep working. */}
            <Route path="/review" element={<Navigate to="/approvals" replace />} />
            <Route path="/review/:meetingId" element={<RedirectReview />} />
            <Route path="/memory" element={<Navigate to="/ask" replace />} />
            <Route path="/follow-up" element={<Navigate to="/follow-ups?tab=reminders" replace />} />
            <Route path="/agenda" element={<Navigate to="/follow-ups" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function RedirectReview() {
  const { meetingId } = useParams()
  return <Navigate to={`/approvals/${meetingId}`} replace />
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  const [notice, setNotice] = useState<string | null>(null)
  const authedRef = useRef(authed)
  authedRef.current = authed
  useEffect(() => applyTheme(readTheme()), [])
  useEffect(() => {
    const h = () => {
      if (authedRef.current) setNotice('The server no longer accepts the organiser token this tab was using. It may have changed on the server. Sign in again to continue.')
      setToken(null); setAuthed(false)
    }
    window.addEventListener('ps53:unauthorized', h)
    return () => window.removeEventListener('ps53:unauthorized', h)
  }, [])
  return (
    <BrowserRouter>
      {/* Inside the router: toasts may contain links. */}
      <ToastProvider>{authed ? <Shell /> : <SignIn notice={notice} onDone={() => { setNotice(null); setAuthed(true) }} />}</ToastProvider>
    </BrowserRouter>
  )
}
