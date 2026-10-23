import { expect, test, type Page } from '@playwright/test'
import { SKIP_INTRO } from './support/fixtures'

// Scripted organiser walkthrough over REAL processed meetings for demo recordings. It approves
// changes, so each step only runs when DEMO_FLOW names it. The clicks are scripted; the data and
// proposals come from the live backend and model.
const TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = process.env.SHOT_DIR
const STEP = process.env.DEMO_FLOW ?? ''

test.beforeEach(async ({ page }) => { await page.addInitScript(SKIP_INTRO) })

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Organiser token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Meeting Actions', exact: true })).toBeVisible()
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const main = (page: Page) => page.getByRole('main')
const approve = (page: Page) => main(page).getByRole('button', { name: 'Approve', exact: true })
const applied = (page: Page) => main(page).getByText('Approved and applied')

test('meeting 1: answer the identity question, approve, see tasks', async ({ page }) => {
  test.skip(STEP !== 'meeting1' || !TOKEN, 'set DEMO_FLOW=meeting1')
  await signIn(page)
  await page.goto('/approvals/1')
  await expect(main(page).getByRole('heading', { name: /^Proposed changes/ })).toBeVisible()
  await shot(page, 'm1-01-approval')
  if (await main(page).getByPlaceholder('Who is SPEAKER_03?').count()) {  // resumable: answered only once
    await main(page).getByPlaceholder('Who is SPEAKER_03?').fill('Meera')
    await main(page).getByRole('button', { name: 'Map speaker' }).click()
  }
  if (!(await applied(page).count())) {
    await expect(approve(page)).toBeEnabled()
    await shot(page, 'm1-02-ready')
    await approve(page).click()
  }
  await expect(applied(page)).toBeVisible()
  await shot(page, 'm1-03-applied')
  await page.goto('/tasks?task=TASK-2')
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Where this came from' })).toBeVisible()
  await shot(page, 'm1-04-task-provenance')
})

test('meeting 2: cross-meeting changes to existing tasks', async ({ page }) => {
  test.skip(STEP !== 'meeting2' || !TOKEN, 'set DEMO_FLOW=meeting2')
  await signIn(page)
  await page.goto(`/approvals/${process.env.DEMO_MEETING_ID ?? 2}`)
  await expect(main(page).getByRole('heading', { name: /^Proposed changes/ })).toBeVisible()
  await shot(page, 'm2-01-approval')
  if (!(await applied(page).count())) {
    const same = main(page).getByRole('button', { name: /^Same as TASK-/ })
    if (await same.count()) { await same.first().click(); await expect(same).toHaveCount(0) }
    await page.waitForLoadState('networkidle')
    const keep = main(page).getByRole('button', { name: 'Keep the task' })
    if (await keep.count()) { await keep.first().click(); await expect(keep).toHaveCount(0) }
    await page.waitForLoadState('networkidle')
    await expect(approve(page)).toBeEnabled()
    await shot(page, 'm2-02-ready')
    await approve(page).click()
  }
  await expect(applied(page)).toBeVisible()
  await shot(page, 'm2-03-applied')
  // TASK-1 was reported done in the meeting but the model missed it: the organiser marks it.
  await page.goto('/tasks?task=TASK-1')
  const d1 = page.getByRole('dialog')
  await expect(d1.getByRole('heading', { name: 'Move to' })).toBeVisible()
  const done = d1.getByRole('button', { name: 'Done', exact: true })
  if (await done.count()) { await done.click(); await expect(d1.getByText('Done', { exact: true }).first()).toBeVisible() }
  await d1.getByRole('button', { name: 'Close' }).click()
  await page.goto('/tasks?task=TASK-2')
  const d2 = page.getByRole('dialog')
  await expect(d2.getByRole('heading', { name: 'Approved history' })).toBeVisible()
  await expect(d2.getByText('Waiting for prerequisites')).toHaveCount(0)  // unblocked
  await shot(page, 'm2-04-task2-history')
})

test('read-only screens: agenda, a model answer, the code-mixed meeting', async ({ page }) => {
  test.skip(STEP !== 'screens' || !TOKEN, 'set DEMO_FLOW=screens')
  test.setTimeout(600_000)
  await signIn(page)
  await page.goto('/follow-ups')
  await expect(page.getByRole('heading', { level: 1, name: 'Follow-ups' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, 's-agenda')
  await page.goto('/ask')
  await main(page).getByLabel('Question').fill('When is the finance sign-off follow-up due and who owns it?')
  await main(page).getByRole('button', { name: 'Ask' }).click()
  await expect(main(page).getByText(/^(Answer from the meeting records|Not supported by the meeting records|Nothing found in stored meetings|Model unavailable)$/)).toBeVisible({ timeout: 540_000 })
  await shot(page, 's-ask')
  await page.goto('/meetings/3')
  await expect(page.getByRole('heading', { level: 1, name: /code-mixed/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, 's-meeting3')
})

test('audio: upload a recording through the UI and get a transcript', async ({ page }) => {
  test.skip(STEP !== 'audio' || !TOKEN || !process.env.AUDIO_FILE, 'set DEMO_FLOW=audio and AUDIO_FILE')
  test.setTimeout(1_500_000)
  await signIn(page)
  await page.goto('/meetings/new')
  await main(page).getByLabel('Meeting title').fill(process.env.AUDIO_TITLE ?? 'Audio upload check (synthetic TTS)')
  await main(page).getByRole('radio', { name: /Upload recording/ }).click()
  await main(page).getByLabel('Recording file').setInputFiles(process.env.AUDIO_FILE!)
  await main(page).getByLabel(/I confirm that every participant agreed/).check()
  await main(page).getByRole('button', { name: 'Analyze meeting' }).click()
  await expect(main(page).getByText(/^Processing: /).first()).toBeVisible()
  await shot(page, 'a-01-processing')
  await expect(main(page).getByText(/^(Needs review|Ready to approve|Processed)$/).first()).toBeVisible({ timeout: 1_440_000 })
  await page.waitForLoadState('networkidle')
  await shot(page, 'a-02-meeting')
  await main(page).getByRole('link', { name: 'Review and approve tasks' }).first().click()
  await expect(main(page).getByRole('heading', { name: /^Proposed changes/ })).toBeVisible()
  await shot(page, 'a-03-approval')
})

test('read-only: screens of one processed meeting and its approval', async ({ page }) => {
  test.skip(STEP !== 'meeting-screens' || !TOKEN || !process.env.MEETING_ID, 'set DEMO_FLOW=meeting-screens and MEETING_ID')
  const id = process.env.MEETING_ID
  await signIn(page)
  await page.goto(`/meetings/${id}`)
  await expect(main(page).getByRole('heading', { name: 'Meeting summary' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, `m${id}-meeting`)
  await page.goto(`/approvals/${id}`)
  await expect(main(page).getByRole('heading', { name: /^Proposed changes/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, `m${id}-approval`)
})
