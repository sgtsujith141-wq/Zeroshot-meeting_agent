// Microphone refused or impossible. Without --use-fake-ui-for-media-stream, headless Chromium
// cannot prompt and answers NotSupportedError (tested as is); a "Block" is reproduced at the API.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from '../support/fixtures'
import { startSandbox } from '../support/sandbox'

const main = (page: Page) => page.getByRole('main')

test('Re-record discards the take and returns to Record', async ({ page }) => {
  const sb = await startSandbox('empty', 'rerecord')
  try {
    // A working microphone stream, so this file's no-prompt browser can record.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dst = ctx.createMediaStreamDestination()
        osc.connect(dst); osc.start(); return dst.stream
      }
    })
    await signIn(page, sb, '/meetings/new')
    const rec = main(page).getByTestId('recorder')
    await rec.getByRole('button', { name: 'Record' }).click()
    await expect(rec).toHaveAttribute('data-state', 'recording')
    await page.waitForTimeout(1500)
    await rec.getByRole('button', { name: 'Stop' }).click()
    await expect(rec).toHaveAttribute('data-state', 'recorded')
    await rec.getByRole('button', { name: 'Re-record' }).click()
    await expect(rec).toHaveAttribute('data-state', 'idle')
    await expect(rec.getByRole('button', { name: 'Record' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Transcribe recording' })).toBeDisabled()
  } finally { await sb.stop() }
})

test.use({ launchOptions: { ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--use-fake-device-for-media-stream'] }, permissions: [] })

test('a browser that cannot prompt for the microphone is told so, with the upload as the way forward', async ({ page }) => {
  const sb = await startSandbox('empty', 'mic-unsupported')
  try {
    await signIn(page, sb, '/meetings/new')
    const rec = main(page).getByTestId('recorder')
    await rec.getByRole('button', { name: 'Record' }).click()
    await expect(rec).toHaveAttribute('data-state', 'unsupported', { timeout: 15_000 })
    await expect(rec.getByRole('alert')).toContainText('upload a recording instead')
  } finally { await sb.stop() }
})

test('Record explains the denial, never claims to record, and offers the upload instead', async ({ page }) => {
  const sb = await startSandbox('empty', 'mic-denied')
  try {
    // What Chrome, Safari and Firefox return after "Block": getUserMedia rejects with NotAllowedError.
    // (Headless Chromium cannot show the prompt, so the rejection is produced at the API here.)
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await signIn(page, sb, '/meetings/new')
    const rec = main(page).getByTestId('recorder')
    await rec.getByRole('button', { name: 'Record' }).click()
    await expect(rec).toHaveAttribute('data-state', 'denied', { timeout: 15_000 })
    await expect(rec.getByRole('alert')).toContainText('Microphone access was denied')
    await expect(rec.getByRole('status')).not.toHaveText('Recording') // the recording state is never shown
    await expect(main(page).getByRole('button', { name: 'Transcribe recording' })).toBeDisabled()
    await main(page).getByRole('radio', { name: /Upload recording/ }).click()
    await expect(main(page).getByLabel('Recording file')).toBeAttached()
  } finally { await sb.stop() }
})
