import { useCallback, useEffect, useMemo, useState } from 'react'

/** Optional opening for a live pitch (/?present=1). It never appears otherwise, can be skipped at
 *  any moment, and only shows words and linework: no fake processing, numbers or claims. */

const SCENES: string[][] = [
  ['AI can already write the minutes.'],
  ['But meetings don’t fail because', 'we forget what was said.'],
  ['They fail because work gets lost afterward.'],
]
const HOLD = [3400, 4600, 3800] // ms each scene stays before the next; Space or → moves on sooner
const THREADS = 7

/** Conversation threads: irregular waves on the left that resolve into evenly spaced rows of work. */
function threadPath(i: number) {
  const y0 = 600 + ((i * 37) % 7) * 34 - 40            // where the thread enters, deliberately uneven
  const amp = 26 + ((i * 13) % 5) * 9                   // how much it wanders
  const yt = 596 + i * 34                               // the row it settles into
  const wave = [80, 230, 380, 530].map((x, k) => `${x} ${y0 + (k % 2 ? -amp : amp) + (i % 3) * 6}`)
  return `M -40 ${y0} C ${wave[0]}, ${wave[1]}, 300 ${y0 + (i % 2 ? 18 : -18)} S ${wave[3]}, 660 ${(y0 + yt) / 2} S 820 ${yt}, 900 ${yt} L 1260 ${yt}`
}

export default function PresentIntro({ onEnter }: { onEnter: () => void }) {
  const [scene, setScene] = useState(0)
  const [line, setLine] = useState(1) // lines of the current scene shown so far
  const brand = scene >= SCENES.length
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const paths = useMemo(() => Array.from({ length: THREADS }, (_, i) => threadPath(i)), [])

  const next = useCallback(() => {
    if (brand) return onEnter()
    if (line < SCENES[scene].length) return setLine(line + 1)
    setScene(scene + 1); setLine(1)
  }, [brand, line, scene, onEnter])
  const back = useCallback(() => { if (scene > 0) { setScene(scene - 1); setLine(SCENES[scene - 1]?.length ?? 1) } }, [scene])

  // Auto-advance: the second line of a scene follows after a beat; scenes hold for HOLD ms.
  useEffect(() => {
    if (brand) return
    const wait = line < SCENES[scene].length ? 1300 : HOLD[scene]
    const t = setTimeout(next, wait)
    return () => clearTimeout(t)
  }, [scene, line, brand, next])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEnter() }
      else if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [next, back, onEnter])

  // How far each thread is drawn, and which threads are "lost", per scene.
  const drawn = brand ? 0 : [560, 470, 470][scene]
  const lost = (i: number) => !brand && scene === 2 && i % 2 === 1
  return (
    <main aria-label="Presentation introduction" data-scene={brand ? 'brand' : scene}
      className="fixed inset-0 z-[70] overflow-hidden bg-[#F5F2EB] text-[#19262A]" style={{ colorScheme: 'light' }}>
      <svg aria-hidden viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {paths.map((d, i) => (
          <path key={i} d={d} pathLength={1000} fill="none" stroke="#C8583D" strokeWidth={1.4} strokeLinecap="round"
            style={{
              strokeDasharray: 1000, strokeDashoffset: reduce ? (brand ? 0 : 450) : drawn,
              opacity: lost(i) ? 0.12 : brand ? 0.62 : 0.42,
              transition: `stroke-dashoffset ${brand ? 2.2 : 2.8}s cubic-bezier(.3,.6,.2,1) ${i * 90}ms, opacity 1.2s ease`,
            }} />
        ))}
        {Array.from({ length: THREADS }, (_, i) => {
          const y = 596 + i * 34
          return (
            <g key={i} style={{ opacity: brand ? 1 : 0, transition: `opacity .6s ease ${1500 + i * 120}ms` }}>
              <circle cx={1282} cy={y} r={8} fill="#FFFFFF" stroke="#C8583D" strokeWidth={1.4} />
              <path d={`M ${1278} ${y} l 3 3 l 5.5 -6`} fill="none" stroke="#C8583D" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}
      </svg>

      <button type="button" onClick={onEnter}
        className="absolute right-5 top-5 z-10 rounded-md px-3 py-1.5 text-[13.5px] font-medium text-[#5A676E] hover:bg-white hover:text-[#19262A]">
        Skip intro
      </button>

      <div className="absolute inset-x-0 top-[18%] z-10 mx-auto max-w-[980px] px-8" aria-live="polite">
        {!brand ? (
          <div key={scene} className="space-y-1">
            {SCENES[scene].slice(0, line).map((t, i) => (
              <p key={t} className="display anim-rise text-[clamp(34px,5vw,72px)] leading-[1.08]" style={{ animationDelay: `${i ? 0 : 80}ms` }}>{t}</p>
            ))}
          </div>
        ) : (
          <div className="anim-rise">
            <div className="flex items-center gap-3">
              <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden>
                <rect width="32" height="32" rx="8" fill="#C8583D" />
                <path d="M9 11h14M9 16h8M9 21h5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
                <path d="m18.5 21 2.4 2.4L25.5 18.8" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h1 className="text-[clamp(36px,4.4vw,60px)] font-semibold tracking-[-0.025em]">Meeting Actions</h1>
            </div>
            <p className="display mt-3 text-[clamp(24px,2.6vw,36px)] italic text-[#5A676E]">From conversation to completed work.</p>
            <button type="button" onClick={onEnter} autoFocus
              className="mt-10 inline-flex h-11 items-center rounded-lg bg-[#AB452E] px-6 text-[15px] font-medium text-white shadow-[0_8px_24px_-10px_rgb(171_69_46/0.55)] transition-colors hover:bg-[#933823] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8583D]">
              Enter workspace
            </button>
          </div>
        )}
      </div>

      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 text-[12.5px] text-[#5A676E]">
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map(i => <span key={i} className={`h-[3px] w-7 rounded-full transition-colors ${i <= scene ? 'bg-[#C8583D]' : 'bg-[#D2D0C7]'}`} />)}
        </div>
        {!brand && <span>Space to continue · Esc to skip</span>}
      </div>
    </main>
  )
}
