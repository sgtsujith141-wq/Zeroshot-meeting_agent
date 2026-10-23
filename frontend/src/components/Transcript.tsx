import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { fmtTime } from '../lib/api'

export interface TSeg { seg_key: string; speaker_label: string; start_seconds: number; end_seconds: number | null; text: string; revision?: number }
export interface Focus { key: string; n: number }

/** Speaker-labelled transcript as compact rows. `focus` scrolls to and flashes one segment
 *  (evidence links); `highlight` marks lines that support what the user is looking at;
 *  `onEdit` lets the organiser correct a line (stored by the server as a new revision). */
export default function Transcript({ segments, names, focus, highlight, audio, hasAudio, maxHeight, onEdit }: {
  segments: TSeg[]; names: Record<string, string | null>; focus?: Focus | null; highlight?: Set<string>
  audio?: React.RefObject<HTMLAudioElement | null>; hasAudio?: boolean; maxHeight?: string
  onEdit?: (segKey: string, text: string) => Promise<boolean>
}) {
  const box = useRef<HTMLOListElement>(null)
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!focus || !box.current) return
    const el = box.current.querySelector<HTMLElement>(`[data-seg="${CSS.escape(focus.key)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('seg-flash')
    void el.offsetWidth // restart the flash
    el.classList.add('seg-flash')
  }, [focus])

  async function save() {
    if (!editing || !onEdit) return
    setSaving(true)
    if (await onEdit(editing.key, editing.text.trim())) setEditing(null)
    setSaving(false)
  }

  if (!segments.length) return <p className="py-6 text-[14px] text-faint">No transcript yet.</p>
  return (
    <ol ref={box} aria-label="Transcript" className="scroll-quiet divide-y divide-rule overflow-y-auto" style={{ maxHeight }}>
      {segments.map(s => {
        const name = names[s.speaker_label]
        const shown = name && name !== s.speaker_label ? name : s.speaker_label
        const isEditing = editing?.key === s.seg_key
        return (
          <li key={s.seg_key} id={s.seg_key} data-seg={s.seg_key}
            className={`group grid scroll-mt-24 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 px-1 py-2 ${highlight?.has(s.seg_key) ? 'bg-sky-soft' : ''}`}>
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
              <div className="flex items-baseline gap-1.5 text-[12.5px] font-medium text-slate">
                <span>{shown}</span>{name && name !== s.speaker_label && <span className="font-normal text-faint">{s.speaker_label}</span>}
                {s.revision && s.revision > 1 ? <span className="font-normal text-faint">corrected</span> : null}
                {onEdit && !isEditing && (
                  <button type="button" onClick={() => setEditing({ key: s.seg_key, text: s.text })} aria-label={`Correct ${s.seg_key}`}
                    className="ml-auto inline-flex items-center gap-1 rounded px-1.5 font-normal text-faint opacity-60 hover:text-sky group-hover:opacity-100 focus-visible:opacity-100">
                    <Pencil size={12} aria-hidden />Correct
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className="mt-1 space-y-2">
                  <textarea aria-label={`Corrected text for ${s.seg_key}`} rows={3} autoFocus value={editing.text} onChange={e => setEditing({ key: s.seg_key, text: e.target.value })}
                    className="w-full rounded-md border border-rule-strong bg-panel px-2.5 py-2 text-[14px] text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/25" />
                  <div className="flex gap-2">
                    <button type="button" disabled={saving || !editing.text.trim() || editing.text.trim() === s.text} onClick={save}
                      className="h-7 rounded-md bg-accent px-2.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:bg-panel-3 disabled:text-faint">{saving ? 'Saving…' : 'Save correction'}</button>
                    <button type="button" onClick={() => setEditing(null)} className="h-7 rounded-md px-2.5 text-[13px] text-slate hover:bg-panel-2">Cancel</button>
                  </div>
                </div>
              ) : <p className="spoken text-ink">{s.text}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
