import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from './ui'

/** Browser microphone recording. Nothing is requested before the person presses Record, the
 *  meter shows the microphone's measured level (an AnalyserNode on the live stream), and the
 *  recording stays in the browser until the parent uploads it. */

export interface Recording { blob: Blob; file: File; seconds: number; url: string }
type State = 'idle' | 'asking' | 'recording' | 'recorded' | 'denied' | 'nodevice' | 'unsupported' | 'error'

const MAX_SECONDS = 30 * 60
const MIN_SECONDS = 1
const BARS = 96 // levels kept for the meter; one every ~80 ms while recording
const TYPES: [string, string][] = [['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/mp4', 'm4a'], ['audio/ogg;codecs=opus', 'ogg']]

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
function supported() {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}
function pickType(): [string, string] | null {
  for (const t of TYPES) if (MediaRecorder.isTypeSupported(t[0])) return t
  return null
}

/** The level history as bars. While recording it scrolls; afterwards it is the whole take, and
 *  the part already played is drawn in the accent colour. */
function Meter({ levels, progress, live }: { levels: number[]; progress?: number; live: boolean }) {
  const shown = live ? levels.slice(-BARS) : resample(levels, BARS)
  return (
    <div aria-hidden className="flex h-16 items-center gap-[3px]">
      {Array.from({ length: BARS }, (_, i) => {
        const v = shown[i - (BARS - shown.length)] ?? (live ? 0 : undefined)
        const played = progress != null && i / BARS < progress
        return <span key={i} className={`w-full rounded-full transition-[height] duration-75 ${v == null ? 'bg-rule' : played ? 'bg-accent' : live ? 'bg-accent' : 'bg-rule-strong'}`}
          style={{ height: `${Math.max(6, Math.min(100, (v ?? 0) * 100))}%`, opacity: v == null ? 0.5 : 1 }} />
      })}
    </div>
  )
}
function resample(a: number[], n: number) {
  if (a.length <= n) return a
  return Array.from({ length: n }, (_, i) => {
    const s = Math.floor((i * a.length) / n), e = Math.max(s + 1, Math.floor(((i + 1) * a.length) / n))
    return Math.max(...a.slice(s, e))
  })
}

export default function Recorder({ value, onChange }: { value: Recording | null; onChange: (r: Recording | null) => void }) {
  const [state, setState] = useState<State>(value ? 'recorded' : supported() ? 'idle' : 'unsupported')
  const [permission, setPermission] = useState<PermissionState | 'unknown'>('unknown')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const rec = useRef<{ stream: MediaStream; recorder: MediaRecorder; ctx: AudioContext; raf: number; timer: number } | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => { // the browser's own record of the microphone permission, where it reports one
    let status: PermissionStatus | null = null
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(s => {
      status = s; setPermission(s.state); s.onchange = () => setPermission(s.state)
    }).catch(() => setPermission('unknown'))
    return () => { if (status) status.onchange = null }
  }, [])

  const release = useCallback(() => {
    const r = rec.current
    if (!r) return
    cancelAnimationFrame(r.raf); clearInterval(r.timer)
    r.stream.getTracks().forEach(t => t.stop()) // the browser's recording indicator goes off
    void r.ctx.close().catch(() => {})
    rec.current = null
  }, [])
  useEffect(() => () => { if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop(); release() }, [release])

  async function start() {
    setError(null)
    const type = pickType()
    if (!type) { setState('unsupported'); return }
    setState('asking')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = (e as DOMException).name
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('nodevice')
      else if (name === 'NotSupportedError' || name === 'TypeError') setState('unsupported') // e.g. not a secure origin
      else { setState('error'); setError(`The microphone could not be opened (${name || String(e)}).`) }
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const recorder = new MediaRecorder(stream, { mimeType: type[0] })
    const chunks: Blob[] = []
    const all: number[] = []
    let t0 = 0
    let last = 0
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.onstart = () => {
      // Only now is the microphone actually being recorded.
      t0 = performance.now(); setElapsed(0); setLevels([]); setState('recording')
      const tick = () => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
        const rms = Math.sqrt(sum / samples.length)
        const now = performance.now()
        if (now - last > 80) { last = now; all.push(Math.min(1, rms * 4)); setLevels([...all.slice(-BARS * 4)]) }
        if (rec.current) rec.current.raf = requestAnimationFrame(tick)
      }
      rec.current!.raf = requestAnimationFrame(tick)
      rec.current!.timer = window.setInterval(() => {
        const s = (performance.now() - t0) / 1000
        setElapsed(s)
        if (s >= MAX_SECONDS) recorder.stop()
      }, 200)
    }
    recorder.onstop = () => {
      const seconds = (performance.now() - t0) / 1000
      release()
      const blob = new Blob(chunks, { type: type[0].split(';')[0] })
      if (seconds < MIN_SECONDS || !blob.size) {
        setState('error'); setError('The recording was too short or empty. Record again.'); onChange(null); return
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      const file = new File([blob], `recording-${stamp}.${type[1]}`, { type: blob.type })
      setLevels(all)
      setState('recorded')
      onChange({ blob, file, seconds, url: URL.createObjectURL(blob) })
    }
    recorder.onerror = () => { release(); setState('error'); setError('Recording stopped because the browser reported an error.') }
    rec.current = { stream, recorder, ctx, raf: 0, timer: 0 }
    recorder.start(250)
  }
  function stop() { if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop() }
  function again() {
    audio.current?.pause()
    if (value) URL.revokeObjectURL(value.url)
    onChange(null); setLevels([]); setElapsed(0); setProgress(0); setPlaying(false); setState('idle')
  }
  function toggle() {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play(); else a.pause()
  }

  const status = state === 'asking' ? 'Waiting for microphone permission…'
    : state === 'recording' ? 'Recording' : state === 'recorded' ? 'Recorded, not uploaded yet'
    : permission === 'denied' ? 'Microphone blocked for this site' : permission === 'granted' ? 'Microphone allowed' : 'Microphone not requested yet'

  return (
    <div className="rounded-xl border border-rule bg-panel p-5 sm:p-6" data-testid="recorder" data-state={state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p role="status" className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
          <span aria-hidden className={`h-2 w-2 rounded-full ${state === 'recording' ? 'anim-pulse bg-accent' : state === 'recorded' ? 'bg-done-dot' : 'bg-rule-strong'}`} />{status}
        </p>
        <span className="tnum text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink"><span className="sr-only">Elapsed </span>
          {clock(state === 'recorded' && value ? (playing || progress ? progress * value.seconds : value.seconds) : elapsed)}
        </span>
      </div>

      <div className="mt-4">
        {state === 'recording' || (state === 'recorded' && levels.length) ? (
          <Meter levels={levels} live={state === 'recording'} progress={state === 'recorded' ? progress : undefined} />
        ) : <div aria-hidden className="flex h-16 items-center"><span className="h-px w-full bg-rule-strong" /></div>}
      </div>
      {state === 'recording' && <p className="mt-1 text-[12.5px] text-faint">The bars are the measured microphone level. Speak normally; recording stops by itself at 30 minutes.</p>}

      {state === 'denied' && <p role="alert" className="mt-3 text-[13.5px] text-cancel">Microphone access was denied. Allow the microphone for this site in the browser's address bar, then press Record again, or upload a recording instead.</p>}
      {state === 'nodevice' && <p role="alert" className="mt-3 text-[13.5px] text-cancel">No microphone was found. Connect one and press Record again, or upload a recording instead.</p>}
      {state === 'unsupported' && <p role="alert" className="mt-3 text-[13.5px] text-cancel">This browser cannot record audio on this page. Open the app at http://127.0.0.1 or over https in a current browser (Safari, Firefox, Chrome or Edge), or upload a recording instead.</p>}
      {error && <p role="alert" className="mt-3 text-[13.5px] text-cancel">{error}</p>}

      {value && <audio ref={audio} src={value.url} preload="metadata" className="sr-only" aria-label="Recorded audio"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime / Math.max(0.1, value.seconds))} />}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {state === 'recording' ? (
          <Button kind="primary" className="h-10 px-5 text-[14px]" icon={<Square size={14} fill="currentColor" />} onClick={stop}>Stop</Button>
        ) : state === 'recorded' && value ? (<>
          <Button className="h-10 px-4 text-[14px]" icon={playing ? <Pause size={15} /> : <Play size={15} />} onClick={toggle}>{playing ? 'Pause' : 'Play'}</Button>
          <Button kind="ghost" className="h-10 px-3 text-[14px]" icon={<RotateCcw size={15} />} onClick={again}>Re-record</Button>
          <span className="text-[13px] text-slate">{clock(value.seconds)} recorded, {(value.blob.size / 1e6).toFixed(value.blob.size > 1e6 ? 1 : 2)} MB</span>
        </>) : state !== 'unsupported' && (
          <Button kind="primary" className="h-10 px-5 text-[14px]" icon={<Mic size={16} />} loading={state === 'asking'} onClick={start}>
            {state === 'asking' ? 'Waiting for permission' : state === 'idle' ? 'Record' : 'Record again'}
          </Button>
        )}
      </div>
    </div>
  )
}
