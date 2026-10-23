import { useEffect, useRef } from 'react'
import { fmtTime } from '../lib/api'
import { Avatar } from './ui'

export interface TSeg { seg_key: string; speaker_label: string; start_seconds: number; end_seconds: number | null; text: string; revision?: number }
export interface Focus { key: string; n: number }

/** Speaker-labelled transcript. `focus` scrolls to and flashes one segment (evidence chips);
 *  `highlight` marks the lines that support whatever the user is looking at. */
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
    void el.offsetWidth // restart the flash animation
    el.classList.add('seg-flash')
  }, [focus])

  if (!segments.length) return <p className="px-4 py-6 text-[14px] text-faint">No transcript yet.</p>
  return (
    <ol ref={box} className="scroll-quiet space-y-0.5 overflow-y-auto px-2 py-2" style={{ maxHeight }}>
      {segments.map(s => {
        const name = names[s.speaker_label]
        const shown = name && name !== s.speaker_label ? name : s.speaker_label
        const on = highlight?.has(s.seg_key)
        return (
          <li key={s.seg_key} id={s.seg_key} data-seg={s.seg_key}
            className={`scroll-mt-24 rounded-lg px-2.5 py-2 transition-colors ${on ? 'bg-sky-soft' : ''} target:bg-ask-soft`}>
            <div className="mb-0.5 flex items-center gap-2 text-[12.5px]">
              <Avatar name={name} size={18} />
              <span className="font-medium text-ink">{shown}</span>
              {name && name !== s.speaker_label && <span className="text-faint">{s.speaker_label}</span>}
              {hasAudio && audio ? (
                <button type="button" className="tnum text-faint hover:text-sky" title="Play from here"
                  onClick={() => { if (audio.current) { audio.current.currentTime = s.start_seconds; void audio.current.play() } }}>
                  {fmtTime(s.start_seconds)}
                </button>
              ) : <span className="tnum text-faint">{fmtTime(s.start_seconds)}{s.end_seconds != null && `–${fmtTime(s.end_seconds)}`}</span>}
              <span className="ml-auto text-faint">{s.seg_key}{s.revision && s.revision > 1 ? ' (corrected)' : ''}</span>
            </div>
            <p className="spoken pl-[26px] text-ink">{s.text}</p>
          </li>
        )
      })}
    </ol>
  )
}
