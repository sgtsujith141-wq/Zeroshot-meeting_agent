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
  await expect(page.getByText('Changes to existing tasks')).toBeVisible()
  await shot(page, 'm2-01-review')
  // Answer the organiser questions shown by the live proposal (resumable).
  if (!(await page.getByRole('heading', { name: 'Approved and applied' }).count())) {
    const same = page.getByRole('button', { name: /^Same as TASK-/ })
    if (await same.count()) { await same.first().click(); await expect(same).toHaveCount(0) }
    await page.waitForLoadState('networkidle')
    const keep = page.getByRole('button', { name: 'Keep the task' })
    if (await keep.count()) { await keep.first().click(); await expect(keep).toHaveCount(0) }
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /^Approve \d+ change/ })).toBeEnabled()
    await shot(page, 'm2-02-ready')
    await page.getByRole('button', { name: /^Approve \d+ change/ }).click()
  }
  await expect(page.getByRole('heading', { name: 'Approved and applied' })).toBeVisible()
  await shot(page, 'm2-03-applied')
  // TASK-1 was reported done in the meeting but the model missed it: the organiser marks it.
  await page.getByRole('link', { name: 'Task board', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible()
  await page.getByRole('button', { name: /TASK-1\b.*Finish the refund API/ }).click()
  await expect(page.getByRole('heading', { name: 'Move to' })).toBeVisible()
  const done = page.getByRole('button', { name: 'Done', exact: true })
  if (await done.count()) {
    await done.click()
    await expect(page.getByRole('dialog').getByText('Done', { exact: true }).first()).toBeVisible()
  }
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /TASK-2\b.*Run regression tests/ }).click()
  await expect(page.getByRole('heading', { name: 'Approved history' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('waiting for prerequisites')).toHaveCount(0)  // unblocked
  await shot(page, 'm2-04-task2-history')
})

test('read-only screens: agenda, memory answer, code-mixed meeting', async ({ page }) => {
  test.skip(STEP !== 'screens' || !TOKEN, 'set DEMO_FLOW=screens')
  test.setTimeout(600_000)
  await signIn(page)
  await page.goto('/agenda')
  await expect(page.getByRole('heading', { name: 'Next meeting agenda' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, 's-agenda')
  await page.goto('/memory')
  await page.getByLabel('Question').fill('When is the finance sign-off follow-up due and who owns it?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page.getByRole('heading', { name: 'Current approved state' })).toBeVisible({ timeout: 540_000 })
  await shot(page, 's-memory')
  await page.goto('/meetings/3')
  await expect(page.getByRole('heading', { name: /code-mixed/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shot(page, 's-meeting3')
})
