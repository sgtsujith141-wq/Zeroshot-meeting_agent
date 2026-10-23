// Round 2 judge rehearsal with the live services (local Whisper + Ollama), scenarios A and B.
// The "microphone" is Chromium's capture device playing macOS text-to-speech, so the speech is
// synthetic; everything after the sound card is real. Takes a few minutes (the model).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from '../support/fixtures'
import { apiFor, startSandbox } from '../support/sandbox'

const SPEECH = 'Okay team. Rahul, please finish the refund API by Thursday. Priya, once the API is merged, please run the regression tests by Friday. We decided to keep Stripe, because switching would delay the release.'
const main = (page: Page) => page.getByRole('main')
const dir = mkdtempSync(path.join(tmpdir(), 'ps53-judge-'))
function wav(name: string, parts: [string, string][]): string | null {
  try {
    const files = parts.map(([voice, text], i) => {
      const f = path.join(dir, `${name}-${i}.aiff`)
      execFileSync('say', ['-v', voice, '-o', f, text])
      return f
    })
    const list = path.join(dir, `${name}.txt`)
    writeFileSync(list, files.map(f => `file '${f}'`).join('\n'))
    const out = path.join(dir, `${name}.wav`)
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-af', 'apad=pad_dur=1', '-ac', '1', '-ar', '48000', out])
    return out
  } catch { return null }
}
const MIC = wav('mic', [['Samantha', SPEECH]])
const TWO = wav('two', [['Samantha', 'Rahul, can you finish the refund API by Thursday?'], ['Daniel', 'Yes, I will finish it by Thursday.']])

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(MIC ? [`--use-file-for-fake-audio-capture=${MIC}`] : [])],
  },
  permissions: ['microphone'],
})

test('A: record → play → transcribe → correct → analyse (live model) → results → report', async ({ page }) => {
  test.skip(!MIC, 'macOS say and FFmpeg are needed to make the test speech')
  test.setTimeout(12 * 60_000)
  const sb = await startSandbox('empty', 'judge-live')
  try {
    await signIn(page, sb, '/meetings/new')
    const rec = main(page).getByTestId('recorder')
    await rec.getByRole('button', { name: 'Record' }).click()
    await expect(rec).toHaveAttribute('data-state', 'recording', { timeout: 20_000 })
    await page.waitForTimeout(16_000)
    await rec.getByRole('button', { name: 'Stop' }).click()
    await rec.getByRole('button', { name: 'Play' }).click()
    await rec.getByRole('button', { name: 'Pause' }).click()
    await main(page).getByLabel('Meeting title').fill('Judge rehearsal recording (synthetic TTS)')
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    const t0 = Date.now()
    await main(page).getByRole('button', { name: 'Transcribe recording' }).click()
    await expect(main(page).getByRole('heading', { name: 'Transcript ready' })).toBeVisible({ timeout: 4 * 60_000 })
    const transcribed = Date.now() - t0
    const transcript = main(page).getByRole('list', { name: 'Transcript' })
    await expect(transcript).toContainText(/refund/i)
    await expect(transcript).toContainText(/regression/i)
    await main(page).getByRole('button', { name: 'Correct s1' }).click()
    const box = main(page).getByLabel('Corrected text for s1')
    await box.fill(`${await box.inputValue()} (checked)`)
    await main(page).getByRole('button', { name: 'Save correction' }).click()
    await expect(transcript).toContainText('corrected')
    const t1 = Date.now()
    await main(page).getByRole('button', { name: 'Analyze meeting' }).click()
    await expect(main(page).getByRole('heading', { level: 2, name: 'Meeting summary' })).toBeVisible({ timeout: 8 * 60_000 })
    const analysed = Date.now() - t1
    console.log(`JUDGE-A transcript after ${(transcribed / 1000).toFixed(1)} s; analysis after ${(analysed / 1000).toFixed(1)} s`)
    const id = Number(page.url().split('/').pop())
    const m = await apiFor(sb).get<{ minutes: { summary?: string }; processing_status: string; segments: { revision: number }[] }>(`/api/meetings/${id}`)
    expect(m.processing_status).toBe('ready_for_review')
    expect(m.minutes.summary).toBeTruthy()
    expect(m.segments[0].revision).toBe(2) // the corrected text is what was analysed
    await expect(main(page).getByRole('heading', { level: 2, name: /^Action items/ })).toBeVisible()
    const cs = await apiFor(sb).get<{ proposal: { items: { title: string; owner: string | null; state: string }[] } }>(`/api/meetings/${id}/changeset`)
    console.log('JUDGE-A proposals:', JSON.stringify(cs.proposal.items.map(i => [i.title, i.owner, i.state])))
    await expect(main(page).getByRole('link', { name: 'Review and approve tasks' }).first()).toBeVisible()
    const dl = page.waitForEvent('download')
    await main(page).getByRole('button', { name: 'Download meeting report' }).click()
    const pdf = path.join(dir, 'a.pdf')
    writeFileSync(pdf, readFileSync((await (await dl).path())!))
    const text = execFileSync('pdftotext', [pdf, '-']).toString().split(/\s+/).join(' ')
    expect(text).toContain('Judge rehearsal recording (synthetic TTS)')
    expect(text).toContain('DRAFT: PENDING APPROVAL')
    expect(text).toContain('whisper-local')
  } finally { await sb.stop() }
})

test('B: two voices through local Whisper are not presented as two speakers', async ({ page }) => {
  test.skip(!TWO, 'macOS say and FFmpeg are needed to make the test speech')
  test.setTimeout(5 * 60_000)
  const sb = await startSandbox('empty', 'judge-two')
  try {
    await signIn(page, sb, '/meetings/new')
    await main(page).getByRole('radio', { name: /Upload recording/ }).click()
    await main(page).getByLabel('Recording file').setInputFiles(TWO!)
    await main(page).getByLabel('Meeting title').fill('Two voices (synthetic TTS)')
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    await main(page).getByRole('button', { name: 'Analyze meeting' }).click()
    // The transcript appears while the analysis runs; the speaker notice is shown.
    await expect(main(page).getByRole('list', { name: 'Transcript' })).toContainText(/refund/i, { timeout: 3 * 60_000 })
    await expect(main(page).getByText('Speaker separation is not available with the current transcription provider.', { exact: false })).toBeVisible()
    const id = Number(page.url().split('/').pop())
    const m = await apiFor(sb).get<{ segments: { speaker_label: string }[]; stt_provider: string }>(`/api/meetings/${id}`)
    expect(m.stt_provider).toBe('whisper-local')
    expect([...new Set(m.segments.map(s => s.speaker_label))]).toEqual(['SPEAKER_00']) // no invented speaker IDs
  } finally { await sb.stop() }
})
