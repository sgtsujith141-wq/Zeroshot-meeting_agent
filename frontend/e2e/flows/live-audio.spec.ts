// Recording in the browser, end to end: the real getUserMedia → MediaRecorder → upload → server
// speech-to-text → transcript on the page, then a correction. Chromium's fake capture device plays
// a macOS text-to-speech WAV as the microphone, so the speech is synthetic but every step after
// the sound card is the real one. Needs macOS `say`, FFmpeg and the local Whisper model.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from '../support/fixtures'
import { apiFor, startSandbox } from '../support/sandbox'

const SPEECH = 'Okay, quick planning check. Rahul, please finish the refund API by Thursday. Priya will run the regression tests once the API is merged.'
const main = (page: Page) => page.getByRole('main')

function speechWav(): string | null {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'ps53-mic-'))
    execFileSync('say', ['-v', 'Samantha', '-o', path.join(dir, 's.aiff'), SPEECH])
    // A second of silence after the sentence: Chromium loops the file.
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', path.join(dir, 's.aiff'), '-af', 'apad=pad_dur=1', '-ac', '1', '-ar', '48000', path.join(dir, 'mic.wav')])
    return path.join(dir, 'mic.wav')
  } catch { return null }
}
const WAV = speechWav()

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(WAV ? [`--use-file-for-fake-audio-capture=${WAV}`] : [])],
  },
  permissions: ['microphone'],
})

test('record → stop → play → transcribe shows the recognised words before any analysis; a line can be corrected', async ({ page }) => {
  test.skip(!WAV, 'macOS say and FFmpeg are needed to make the test speech')
  test.setTimeout(5 * 60_000)
  const sb = await startSandbox('empty', 'live-audio')
  try {
    await signIn(page, sb, '/meetings/new')
    await expect(main(page).getByRole('radio', { name: /Record audio/ })).toHaveAttribute('aria-checked', 'true')
    const rec = main(page).getByTestId('recorder')
    await expect(rec).toContainText('Microphone')
    await rec.getByRole('button', { name: 'Record' }).click()
    // The first microphone open in a fresh browser profile can take a few seconds.
    await expect(rec).toHaveAttribute('data-state', 'recording', { timeout: 20_000 })
    await page.waitForTimeout(3000)
    // The meter shows measured input: with speech playing, some bars rise above the floor.
    const tallest = await rec.locator('[aria-hidden] > span').evaluateAll(els => Math.max(...els.map(e => parseFloat((e as HTMLElement).style.height) || 0)))
    expect(tallest).toBeGreaterThan(15)
    await page.waitForTimeout(9000)
    await rec.getByRole('button', { name: 'Stop' }).click()
    await expect(rec).toHaveAttribute('data-state', 'recorded')
    await expect(rec.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(rec.getByRole('button', { name: 'Re-record' })).toBeVisible()
    const seconds = await rec.locator('audio').evaluate((a: HTMLAudioElement) => new Promise<number>(r => {
      if (a.readyState >= 1 && Number.isFinite(a.duration)) return r(a.duration)
      a.addEventListener('loadedmetadata', () => r(a.duration), { once: true }); setTimeout(() => r(-1), 4000)
    }))
    expect(seconds === Infinity || seconds > 10 || seconds === -1).toBeTruthy() // WebM from MediaRecorder may not state its duration
    await rec.getByRole('button', { name: 'Play' }).click()
    await expect(rec.getByRole('button', { name: 'Pause' })).toBeVisible()
    await rec.getByRole('button', { name: 'Pause' }).click()
    await expect(main(page).getByLabel('Meeting title')).toHaveValue(/^Recorded meeting, /) // filled in, editable
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    const t0 = Date.now()
    await main(page).getByRole('button', { name: 'Transcribe recording' }).click()
    await expect(page).toHaveURL(/\/meetings\/\d+$/)
    const id = Number(page.url().split('/').pop())
    await expect(main(page).getByRole('heading', { name: 'Transcript ready' })).toBeVisible({ timeout: 4 * 60_000 })
    const shownAfter = Date.now() - t0
    const transcript = main(page).getByRole('list', { name: 'Transcript' })
    await expect(transcript).toContainText(/refund/i)
    await expect(transcript).toContainText(/regression/i)
    await expect(main(page).getByText('Speaker separation is not available with the current transcription provider.', { exact: false })).toBeVisible()
    const m = await apiFor(sb).get<{ source_type: string; stt_provider: string; processing_status: string; change_set: unknown; segments: { seg_key: string; text: string }[] }>(`/api/meetings/${id}`)
    expect(m).toMatchObject({ source_type: 'audio', stt_provider: 'whisper-local', processing_status: 'transcribed', change_set: null })
    const note = `recording uploaded and transcript visible ${(shownAfter / 1000).toFixed(1)} s after "Transcribe recording"`
    test.info().annotations.push({ type: 'latency', description: note })
    console.log(`LATENCY ${note}`)
    // Correct the first line; the server keeps it as a new revision.
    const first = m.segments[0].seg_key
    await main(page).getByRole('button', { name: `Correct ${first}` }).click()
    await main(page).getByLabel(`Corrected text for ${first}`).fill(`${m.segments[0].text} (checked)`)
    await main(page).getByRole('button', { name: 'Save correction' }).click()
    await expect(transcript).toContainText('(checked)')
    await expect(transcript).toContainText('corrected')
    const after = await apiFor(sb).get<{ segments: { seg_key: string; text: string; revision: number }[] }>(`/api/meetings/${id}`)
    expect(after.segments[0]).toMatchObject({ text: `${m.segments[0].text} (checked)`, revision: 2 })
    await expect(main(page).getByRole('button', { name: 'Analyze meeting' })).toBeEnabled()
  } finally { await sb.stop() }
})
