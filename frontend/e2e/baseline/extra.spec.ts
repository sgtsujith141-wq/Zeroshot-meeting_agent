// BASELINE AUDIT (UI at 10deb16): remaining controls not covered by the other baseline files.
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type CS = { proposal: { clarifications: { kind: string; item_keys: string[]; answer: { choice: string } | null }[]; items: { key: string; existing_task_id: string | null; operation: string }[] }; state: string }
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const cs = (sb: Sandbox, m: number) => apiFor(sb).get<CS>(`/api/meetings/${m}/changeset`)

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'base-extra') })
test.afterEach(async () => { await sb.stop() })

test('V31 "It is a new task" stores a new-task answer and keeps the item separate', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'It is a new task'))
  const c = await cs(sb, 4)
  expect(c.proposal.clarifications.find(q => q.kind === 'possible_existing_match')!.answer!.choice).toBe('new')
  expect(c.proposal.items.find(i => i.key === 'release-notes')).toMatchObject({ existing_task_id: null, operation: 'create' })
})

test('V32 the speaker question\'s "Leave unassigned" is honoured, or the review says why not', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  const q = page.locator('li').filter({ hasText: 'Who is this speaker?' })
  await clickAnd(page, q.getByRole('button', { name: 'Leave unassigned' }))
  const c = await apiFor(sb).get<{ organizer_edits: { answers: Record<string, { choice: string }> }; proposal: { items: { key: string; owner: string | null }[] } }>('/api/meetings/4/changeset')
  expect(c.organizer_edits.answers['login-screen|unmapped_speaker']).toMatchObject({ choice: 'unassigned' })
  const owner = c.proposal.items.find(i => i.key === 'login-screen')!.owner
  test.info().annotations.push({ type: 'observed', description: `login-screen owner after "Leave unassigned": ${owner}` })
  if (owner !== null) await expect(page.getByText(/no longer applies|answer .*not used|was not applied/i).first()).toBeVisible({ timeout: 3000 })
})

test('V33 the applied banner links to the task board', async ({ page }) => {
  await signIn(page, sb, '/review/2')
  await page.getByRole('link', { name: 'Open the task board' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Task board' })).toBeVisible()
})

test('S13 a notification toast can be dismissed', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await page.getByLabel('Name for Asha').fill('Asha R')
  await clickAnd(page, btn(page, 'Confirm').first())
  const toast = page.getByRole('status').filter({ hasText: 'Asha is now Asha R' })
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: 'Dismiss' }).click()
  await expect(toast).toHaveCount(0)
})

test('O06 the review-state chip in the meeting table opens that review', async ({ page }) => {
  await signIn(page, sb)
  await page.getByRole('row').filter({ hasText: 'Audio upload check' }).getByRole('link', { name: 'Questions open' }).click()
  await expect(page).toHaveURL(/\/review\/4$/)
})

test('N07 the meeting date, time and time zone typed in the form are stored', async ({ page, watch }) => {
  watch.allow(/upload/)
  await signIn(page, sb, '/meetings/new')
  await page.route('**/api/meetings/*/upload', r => r.abort())
  await page.getByLabel('Meeting title').fill('Time zone check')
  await page.getByLabel('Date and time').fill('2026-11-03T15:30')
  await page.getByLabel('Meeting time zone').selectOption('Europe/London')
  await page.getByLabel('Recording or transcript').setInputFiles({ name: 't.txt', mimeType: 'text/plain', buffer: Buffer.from('Asha: hello') })
  await page.getByLabel(/I confirm that every participant agreed/).check()
  await clickAnd(page, btn(page, 'Upload and process'), /^POST \/api\/meetings$/)
  const m = (await apiFor(sb).get<{ title: string; scheduled_at: string; timezone: string }[]>('/api/meetings')).find(x => x.title === 'Time zone check')!
  expect(m.timezone).toBe('Europe/London')
  expect(m.scheduled_at.startsWith('2026-11-03T15:30')).toBe(true)
})

test('M14 "Prepare again" makes a new summary version from current data', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await clickAnd(page, btn(page, 'Prepare summary'))
  await clickAnd(page, btn(page, 'Prepare again'))
  expect((await apiFor(sb).get<unknown[]>('/api/meetings/2/summaries')).length).toBe(2)
})

test('O07+O08 Overview header and panel links reach their destinations', async ({ page }) => {
  await signIn(page, sb)
  await page.getByRole('main').getByRole('link', { name: 'New meeting' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Add a meeting' })).toBeVisible()
  await page.goto(sb.url + '/')
  await page.getByRole('link', { name: 'All reviews' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Review changes' })).toBeVisible()
  await page.goto(sb.url + '/')
  await page.getByRole('main').getByRole('link', { name: 'Task board' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Task board' })).toBeVisible()
})

test('V34+M15 breadcrumbs and "Open meeting" navigate', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await page.getByRole('link', { name: 'Open meeting' }).click()
  await expect(page).toHaveURL(/\/meetings\/4$/)
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Overview' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await page.goto(sb.url + '/review/4')
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Review changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Review changes' })).toBeVisible()
})

test('V35+M16 step and event segment buttons focus the transcript line', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  const art = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Finish the login screen' }) })
  await art.getByText(/How this was worked out/).click()
  await art.locator('ol').getByRole('button', { name: /^s2/ }).first().click()
  await expect(page.locator('[data-seg="s2"]')).toHaveClass(/seg-flash/)
  await page.goto(sb.url + '/meetings/2')
  await page.getByRole('button', { name: /^Show \d+ events/ }).click()
  await page.locator('ol').getByRole('button', { name: 's6', exact: true }).last().click()
  await expect(page.locator('[data-seg="s6"]')).toHaveClass(/seg-flash/)
})

test('T11 the task drawer origin link opens the source meeting', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-4\b/ }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Payments release follow-up (synthetic)', exact: true }).click()
  await expect(page).toHaveURL(/\/meetings\/2$/)
})

test('F08 agenda pending-review links open the review', async ({ page }) => {
  await signIn(page, sb, '/agenda')
  await page.getByRole('link', { name: 'Audio upload check (synthetic TTS)' }).click()
  await expect(page).toHaveURL(/\/review\/4$/)
})
