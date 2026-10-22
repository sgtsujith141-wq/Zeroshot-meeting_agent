import { expect, test, type Page } from '@playwright/test'

// Scripted organiser walkthrough over REAL processed meetings (it approves changes,
// so it only runs when DEMO_FLOW is set). The clicks are scripted; the data and
// proposals come from the live backend and model.
const TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = process.env.SHOT_DIR
const STEP = process.env.DEMO_FLOW ?? ''

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Organiser token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Meetings' })).toBeVisible()
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

test('meeting 1: answer identity question, approve, see tasks', async ({ page }) => {
  test.skip(STEP !== 'meeting1' || !TOKEN, 'set DEMO_FLOW=meeting1')
  await signIn(page)
  await page.goto('/review/1')
  await expect(page.getByRole('heading', { name: /Review:/ })).toBeVisible()
  await shot(page, 'm1-01-review')
  if (await page.getByPlaceholder('Who is SPEAKER_03?').count()) {  // resumable: answered only once
    await page.getByPlaceholder('Who is SPEAKER_03?').fill('Meera')
    await page.getByRole('button', { name: 'Map speaker' }).click()
  }
  await expect(page.getByRole('button', { name: /^Approve \d+ change/ })).toBeEnabled()
  await shot(page, 'm1-02-review-ready')
  await page.getByRole('button', { name: /^Approve \d+ change/ }).click()
  await expect(page.getByRole('heading', { name: 'Approved and applied' })).toBeVisible()
  await shot(page, 'm1-03-applied')
  await page.getByRole('link', { name: 'Task board', exact: true }).click()
  await expect(page.getByText('Run regression tests')).toBeVisible()
  await shot(page, 'm1-04-board')
  await page.getByText('Run regression tests').click()
  await expect(page.getByRole('heading', { name: 'Where this came from' })).toBeVisible()
  await shot(page, 'm1-05-task-provenance')
})

test('meeting 2: cross-meeting changes to existing tasks', async ({ page }) => {
  test.skip(STEP !== 'meeting2' || !TOKEN, 'set DEMO_FLOW=meeting2')
  await signIn(page)
  await page.goto(`/review/${process.env.DEMO_MEETING_ID ?? 2}`)
  await expect(page.getByRole('heading', { name: /Review:/ })).toBeVisible()
  await shot(page, 'm2-01-review')
})
