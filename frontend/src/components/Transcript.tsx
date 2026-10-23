import { useEffect, useRef } from 'react'
import { fmtTime } from '../lib/api'

export interface TSeg { seg_key: string; speaker_label: string; start_seconds: number; end_seconds: number | null; text: string; revision?: number }
export interface Focus { key: string; n: number }

/** Speaker-labelled transcript as compact rows. `focus` scrolls to and flashes one segment
 *  (evidence links); `highlight` marks lines that support what the user is looking at. */
export default function Transcript({ segments, names, focus, highlight, audio, hasAudio, maxHeight }: {
  segments: TSeg[]; names: Record<string, string | null>; focus?: Focus | null; highlight?: Set<string>
  audio?: React.RefObject<HTMLAudioElement | null>; hasAudio?: boolean; maxHeight?: string
}) {
  const box = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (!focus || !box.current) return
    const el = box.current.querySelector<HTMLElement>(`[data-seg="${CSS.escape(focus.key)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('seg-flash')
    void el.offsetWidth // restart the flash
    el.classList.add('seg-flash')
  }, [focus])

  if (!segments.length) return <p className="py-6 text-[14px] text-faint">No transcript yet.</p>
  return (
    <ol ref={box} aria-label="Transcript" className="scroll-quiet divide-y divide-rule overflow-y-auto" style={{ maxHeight }}>
      {segments.map(s => {
        const name = names[s.speaker_label]
        const shown = name && name !== s.speaker_label ? name : s.speaker_label
        return (
          <li key={s.seg_key} id={s.seg_key} data-seg={s.seg_key}
            className={`grid scroll-mt-24 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 px-1 py-2 ${highlight?.has(s.seg_key) ? 'bg-sky-soft' : ''}`}>
            <div className="pt-0.5 text-[12.5px] leading-5">
              {hasAudio && audio ? (
                <button type="button" className="tnum text-faint hover:text-sky" title="Play from here" aria-label={`Play from ${fmtTime(s.start_seconds)}`}
                  onClick={() => { if (audio.current) { audio.current.currentTime = s.start_seconds; void audio.current.play().catch(() => {}) } }}>
                  {fmtTime(s.start_seconds)}
                </button>
              ) : <span className="tnum text-faint">{fmtTime(s.start_seconds)}</span>}
              <div className="text-faint">{s.seg_key}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-slate">
                {shown}{name && name !== s.speaker_label && <span className="ml-1.5 font-normal text-faint">{s.speaker_label}</span>}
                {s.revision && s.revision > 1 ? <span className="ml-1.5 font-normal text-faint">corrected</span> : null}
              </div>
              <p className="spoken text-ink">{s.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
