// Every remaining link, reference and secondary control: breadcrumbs, "All …" links, evidence
// references in questions, decisions, checks and steps, and the other orphaned-answer actions.
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

const main = (page: Page) => page.getByRole('main')
const h1 = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 1, name })
const region = (page: Page, name: string) => main(page).getByRole('region', { name: new RegExp(`^${name}`) })

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'links') })
test.afterEach(async () => { await sb.stop() })

test('brand link and the Overview "All …" links', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByRole('complementary').getByRole('link', { name: 'Meeting Actions' }).click()
  await expect(h1(page, 'Meeting Actions')).toBeVisible()
  for (const [link, heading] of [['All approvals', 'Approvals'], ['All tasks', 'Tasks'], ['All meetings', 'Meetings']]) {
    await page.goto(sb.url + '/')
    await main(page).getByRole('link', { name: link }).click()
    await expect(h1(page, heading)).toBeVisible()
  }
  await page.goto(sb.url + '/meetings')
  await main(page).getByRole('link', { name: 'New meeting' }).click()
  await expect(h1(page, 'New meeting')).toBeVisible()
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Meetings' }).click()
  await expect(h1(page, 'Meetings')).toBeVisible()
})

test('meeting results: breadcrumb, "View approved tasks", decision references, Technical details, Hide events', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await region(page, 'Decisions made').getByRole('button', { name: 'Show s4 in transcript' }).click()
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s4"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await main(page).getByRole('tab', { name: 'Technical details' }).click()
  await main(page).getByRole('button', { name: 'Show events' }).click()
  await main(page).getByRole('button', { name: 'Hide events' }).click()
  await expect(main(page).getByRole('button', { name: 'Show events' })).toBeVisible()
  await main(page).getByRole('link', { name: 'View approved tasks' }).first().click()
  await expect(page).toHaveURL(/\/approvals\/2$/)
  await page.goto(sb.url + '/meetings/2')
  await main(page).getByRole('complementary').getByRole('link', { name: 'View approved tasks' }).click()
  await expect(page).toHaveURL(/\/approvals\/2$/)
  await page.goto(sb.url + '/meetings/2')
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Meetings' }).click()
  await expect(h1(page, 'Meetings')).toBeVisible()
})

test('approval: breadcrumb, "Open meeting", question "Details of" and evidence, step, decision and check references, applied link', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const qrow = main(page).locator('li[data-question="ambiguous_deadline"]')
  await qrow.getByRole('button', { name: 'Show s2 in transcript' }).click()
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s2"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await qrow.getByRole('button', { name: 'Details of “Finish the login screen”' }).click()
  const d = page.getByRole('dialog', { name: 'Finish the login screen' })
  await d.getByRole('list').last().getByRole('button', { name: /^s\d+/ }).first().click() // a step's segment
  await expect(page.getByRole('dialog', { name: 'Transcript' })).toBeVisible()
  await page.keyboard.press('Escape')
  await main(page).getByRole('link', { name: 'Open meeting' }).click()
  await expect(page).toHaveURL(/\/meetings\/4$/)
  await page.goto(sb.url + '/approvals/3')
  await region(page, 'Decisions to record').getByRole('button', { name: 'Show s3 in transcript' }).click()
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s3"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await region(page, 'Checks').getByRole('button', { name: 'Show s1 in transcript' }).click()
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s1"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Approvals' }).click()
  await expect(h1(page, 'Approvals')).toBeVisible()
  await page.goto(sb.url + '/approvals/2')
  await main(page).getByRole('link', { name: 'Open tasks' }).click()
  await expect(h1(page, 'Tasks')).toBeVisible()
})

test('orphaned answers: "Make … the owner", "Use …" and "Remove the due date" each apply the earlier answer', async ({ page }) => {
  // Answers stored for questions the current proposal does not ask (as left behind by an older version).
  const cs = await apiFor(sb).get<{ id: number }>('/api/meetings/4/changeset')
  await apiFor(sb).raw('PATCH', `/api/changesets/${cs.id}`, { answers: { 'possible-x|possible_existing_match': null } }) // no-op warm-up
  await apiFor(sb).raw('PATCH', `/api/changesets/${cs.id}`, { answers: { 'release-notes|possible_existing_match': { choice: 'link', value: 'TASK-3' } } })
  await apiFor(sb).raw('PATCH', `/api/changesets/${cs.id}`, { answers: {
    'login-screen|missing_owner': { choice: 'set_owner', value: 'Priya' },
    'mobile-app-launch-sync|ambiguous_deadline': { choice: 'set_due', value: '2026-11-01' },
    'release-notes|ambiguous_deadline': { choice: 'no_deadline', value: null },
  } })
  await signIn(page, sb, '/approvals/4')
  const orphan = page.getByRole('alert').filter({ hasText: 'earlier answers no longer apply' })
  await expect(orphan).toContainText('3 earlier answers no longer apply')
  type It = { key: string; owner: string | null; deadline: { date: string | null } }
  const item = async (k: string) => (await apiFor(sb).get<{ proposal: { items: It[] }; organizer_edits: { answers: Record<string, unknown> } }>('/api/meetings/4/changeset'))
  await clickAnd(page, orphan.getByRole('button', { name: 'Make Priya the owner' }))
  let c = await item('login-screen')
  expect(c.proposal.items.find(i => i.key === 'login-screen')!.owner).toBe('Priya')
  expect(c.organizer_edits.answers['login-screen|missing_owner'] ?? null).toBeNull()
  await clickAnd(page, page.getByRole('alert').getByRole('button', { name: 'Use Sun 1 Nov 2026' }))
  c = await item('mobile-app-launch-sync')
  expect(c.proposal.items.find(i => i.key === 'mobile-app-launch-sync')!.deadline.date).toBe('2026-11-01')
  await clickAnd(page, page.getByRole('alert').getByRole('button', { name: 'Remove the due date' }))
  c = await item('release-notes')
  expect(c.proposal.items.find(i => i.key === 'release-notes')!.deadline.date).toBeNull()
  await expect(page.getByRole('alert').filter({ hasText: 'no longer appl' })).toHaveCount(0)
})

test('ask: "Current approved state" links open the task', async ({ page }) => {
  await signIn(page, sb, '/ask')
  await main(page).getByLabel('Write an answer with the model').uncheck()
  await main(page).getByLabel('Question').fill('Who owns the regression tests?')
  await clickAnd(page, main(page).getByRole('button', { name: 'Ask' }), /memory\/query/)
  await main(page).getByRole('link', { name: 'TASK-2' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Run regression tests' })).toBeVisible()
})

test('follow-ups: agenda meeting links, calendar and reminder task links, the reminder dialog Cancel', async ({ page }) => {
  await signIn(page, sb, '/follow-ups')
  await main(page).getByRole('link', { name: 'from Payments release follow-up (synthetic)' }).first().click()
  await expect(page).toHaveURL(/\/meetings\/2$/)
  await page.goto(sb.url + '/follow-ups?tab=calendar')
  await main(page).getByRole('link', { name: /TASK-4/ }).click()
  await expect(page.getByRole('dialog', { name: 'Prepare the rollback runbook' })).toBeVisible()
  await page.goto(sb.url + '/follow-ups?tab=reminders')
  await main(page).getByRole('link', { name: 'TASK-2' }).click()
  await expect(page.getByRole('dialog', { name: 'Run regression tests' })).toBeVisible()
  await page.goto(sb.url + '/follow-ups?tab=reminders')
  const n = (await apiFor(sb).get<unknown[]>('/api/reminders')).length
  await main(page).getByRole('button', { name: 'New reminder' }).click()
  const d = page.getByRole('dialog', { name: 'New reminder' })
  await d.getByLabel('Task').selectOption('TASK-3')
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
  expect((await apiFor(sb).get<unknown[]>('/api/reminders')).length).toBe(n)
})

test('phone menu: theme switch and sign out work from the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, sb)
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  const before = await theme()
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click()
  expect(await theme()).not.toBe(before)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('Organiser token')).toBeVisible()
})

test('empty database: the Overview and Tasks empty states lead somewhere', async ({ page }) => {
  const empty = await startSandbox('empty', 'links-empty')
  try {
    await signIn(page, empty)
    await main(page).getByRole('link', { name: 'Record or upload a meeting' }).last().click() // the empty state's own link
    await expect(h1(page, 'New meeting')).toBeVisible()
    await page.goto(empty.url + '/tasks')
    await main(page).getByRole('link', { name: 'Go to Approvals' }).click()
    await expect(h1(page, 'Approvals')).toBeVisible()
  } finally { await empty.stop() }
})

test('keyboard: focus stays inside an open dialog or drawer and returns to the opener on close', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const opener = main(page).getByRole('button', { name: 'Reject all', exact: true })
  await opener.focus(); await page.keyboard.press('Enter')
  const dlg = page.getByRole('dialog', { name: 'Reject all proposed changes?' })
  await expect(dlg).toBeVisible()
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    expect(await dlg.evaluate(d => d.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(opener).toBeFocused()
  await page.locator('tr[data-item="login-screen"]').getByRole('button', { name: 'Finish the login screen' }).click()
  const drawer = page.getByRole('dialog', { name: 'Finish the login screen' })
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await drawer.evaluate(d => d.contains(document.activeElement))).toBe(true)
  }
})
