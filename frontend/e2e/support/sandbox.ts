// Disposable backend for browser tests. Each sandbox is a real uvicorn process with its
// own DATA_DIR (a copy of the demo database, or empty) and its own random organiser
// token, so destructive tests never touch the demo server or its data.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const BACKEND = path.join(ROOT, 'backend')
const PY = path.join(BACKEND, '.venv/bin/python')
// Sandboxes copy a pinned snapshot of the demo data when one exists (e2e/.demo-snapshot, git-ignored),
// so tests do not change meaning when someone uses the live demo; otherwise the live demo data.
const SNAPSHOT = path.join(HERE, '..', '.demo-snapshot', 'data')
const SOURCE = process.env.SANDBOX_SOURCE ?? (existsSync(path.join(SNAPSHOT, 'app.db')) ? SNAPSHOT : path.join(BACKEND, 'data'))

export interface Sandbox { url: string; token: string; dir: string; seeded?: { meeting_id: number; kinds: string[] }; stop: () => Promise<void> }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)) })
  })
}

async function waitUp(url: string, proc: ChildProcess, log: string) {
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) throw new Error(`sandbox backend exited early; see ${log}`)
    try { if ((await fetch(`${url}/api/health`)).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`sandbox backend did not start; see ${log}`)
}

/** seed 'demo' copies the demo database; 'empty' starts with no data at all. */
export async function startSandbox(seed: 'demo' | 'empty' = 'demo', name = 'sb', env: Record<string, string> = {}): Promise<Sandbox> {
  const base = process.env.SANDBOX_ROOT ?? path.join(tmpdir(), 'ps53-e2e')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(path.join(base, `${name}-`))
  const data = path.join(dir, 'data')
  if (seed === 'demo') execFileSync(PY, ['-I', path.join(HERE, 'copy_db.py'), SOURCE, data], { stdio: 'pipe' })
  else mkdirSync(data, { recursive: true })
  // Optional: one meeting whose recorded test events raise every remaining question type.
  let seeded: Sandbox['seeded']
  if (env.SEED_QUESTIONS) {
    const out = execFileSync(PY, ['-I', path.join(HERE, 'seed_questions.py'), data, BACKEND], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n')
    seeded = JSON.parse(out[out.length - 1])
  }
  const port = await freePort()
  const token = `sandbox-${randomBytes(9).toString('hex')}`
  const log = path.join(dir, 'server.log')
  const out = openSync(log, 'a')
  const proc = spawn(path.join(BACKEND, '.venv/bin/uvicorn'), ['app.main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
    cwd: BACKEND, stdio: ['ignore', out, out],
    // WHISPER_PREWARM=0: sandboxes start often; a test that transcribes loads the model itself.
    env: { ...process.env, WHISPER_PREWARM: '0', ...env, DATA_DIR: data, ORGANIZER_TOKEN: token, ORGANIZER_NAME: 'Organiser' },
  })
  const url = `http://127.0.0.1:${port}`
  await waitUp(url, proc, log)
  return {
    url, token, dir, seeded,
    stop: () => new Promise<void>(resolve => {
      if (proc.exitCode !== null) return resolve()
      proc.once('exit', () => resolve())
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref()
    }),
  }
}

/** Direct API access with the sandbox token, for checking what the backend really stored. */
export function apiFor(sb: Sandbox) {
  const req = async <T>(method: string, p: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const r = await fetch(sb.url + p, {
      method, headers: { Authorization: `Bearer ${sb.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await r.text()
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, json: json as T }
  }
  return {
    get: <T>(p: string) => req<T>('GET', p).then(r => r.json),
    raw: req,
  }
}
