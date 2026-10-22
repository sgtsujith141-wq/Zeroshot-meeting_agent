import { useEffect, useState, type FormEvent } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api, ApiError, getToken, setToken } from './lib/api'
import { Button, Field, inputCls } from './components/ui'
import Inbox from './pages/Inbox'
import NewMeeting from './pages/NewMeeting'
import MeetingPage from './pages/MeetingPage'
import ReviewPage from './pages/ReviewPage'
import TasksPage from './pages/TasksPage'
import FollowUpPage from './pages/FollowUpPage'
import MemoryPage from './pages/MemoryPage'
import AgendaPage from './pages/AgendaPage'
import DiagnosticsPage from './pages/DiagnosticsPage'

const NAV = [
  { to: '/', label: 'Meetings', end: true },
  { to: '/review', label: 'Review changes' },
  { to: '/tasks', label: 'Task board' },
  { to: '/follow-up', label: 'Calendar & reminders' },
  { to: '/agenda', label: 'Next agenda' },
  { to: '/memory', label: 'Ask past meetings' },
  { to: '/diagnostics', label: 'Diagnostics' },
]

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
    <main className="mx-auto mt-[12vh] max-w-md px-4">
      <h1 className="text-2xl font-semibold">Meeting actions</h1>
      <p className="mt-2 text-slate">Turn what was agreed in meetings into reviewed, tracked tasks. Sign in with the organiser token from the server’s <code>.env</code> file.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-[10px] border border-rule bg-panel p-5">
        <Field label="Organiser token" hint="Kept only in this browser tab. Closing the tab signs you out.">
          <input type="password" autoComplete="current-password" required className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-cancel">{error}</p>}
        <Button kind="primary" type="submit" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Sign in'}</Button>
      </form>
    </main>
  )
}

function Shell() {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-rule bg-panel md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <div className="text-[16px] font-semibold">Meeting actions</div>
            <div className="text-[12.5px] text-slate">Local organiser mode</div>
          </div>
          <button className="md:hidden rounded border border-rule px-2 py-1 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
        </div>
        <nav className={`${open ? 'block' : 'hidden'} px-2 pb-4 md:block`} aria-label="Main">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `block rounded-md px-3 py-1.5 text-[14.5px] ${isActive ? 'bg-paper font-semibold text-ink' : 'text-slate hover:text-ink'}`}>
              {n.label}
            </NavLink>
          ))}
          <button className="mt-6 px-3 text-[13px] text-slate hover:text-ink" onClick={() => { setToken(null); location.reload() }}>Sign out</button>
        </nav>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1180px]">
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
  useEffect(() => {
    const h = () => { setToken(null); setAuthed(false) }
    window.addEventListener('ps53:unauthorized', h)
    return () => window.removeEventListener('ps53:unauthorized', h)
  }, [])
  return <BrowserRouter>{authed ? <Shell /> : <SignIn onDone={() => setAuthed(true)} />}</BrowserRouter>
}
