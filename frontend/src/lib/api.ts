// Thin fetch wrapper. The organiser token is typed in at sign-in and kept in
// sessionStorage for this tab only; it is never part of the built bundle.

const TOKEN_KEY = 'ps53.organiserToken'

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the backend is running on port 8000.')
  }
  if (res.status === 401) window.dispatchEvent(new Event('ps53:unauthorized'))
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      msg = typeof j.detail === 'string' ? j.detail
        : Array.isArray(j.detail) ? j.detail.map((d: { loc?: string[]; msg: string }) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ')
        : msg
    } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  if (raw) return (await res.text()) as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  text: (p: string) => request<string>('GET', p, undefined, true),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, form),
}

export async function download(path: string, filename: string) {
  const body = await api.text(path)
  const type = filename.endsWith('.ics') ? 'text/calendar' : 'text/plain'
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export function fmtTime(sec: number | null | undefined) {
  if (sec == null) return ''
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(r).padStart(2, '0')}`
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
