// Tasks (list, board, drawer, conflicts, dependencies, .ics), Ask AI outcomes, Follow-ups.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type T = { code: string; title: string; owner: string | null; status: string; revision: number; prerequisites: { code: string }[] }
type R = { id: number; task_code: string; channel: string; delivery_state: string; last_error: string | null }
const main = (page: Page) => page.getByRole('main')
const tasks = (sb: Sandbox) => apiFor(sb).get<T[]>('/api/tasks')
const reminders = (sb: Sandbox) => apiFor(sb).get<R[]>('/api/reminders')
const drawer = (page: Page, title: string) => page.getByRole('dialog', { name: title })

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'tafu') })
test.afterEach(async () => { await sb.stop() })

// ---- tasks ---------------------------------------------------------------------------------------

test('tasks list: open tasks by default; search, owner and status filters; Clear', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await expect(main(page).getByText('3 of 4 tasks')).toBeVisible()
  await main(page).getByLabel('Search tasks').fill('runbook')
  await expect(main(page).getByText('1 of 4 tasks')).toBeVisible()
  await main(page).getByLabel('Search tasks').fill('')
  await main(page).getByLabel('Owner').selectOption('Rahul')
  await expect(main(page).getByText('1 of 4 tasks')).toBeVisible()
  await main(page).getByLabel('Status').selectOption('all')
  await expect(main(page).getByText('2 of 4 tasks')).toBeVisible()
  await main(page).getByRole('button', { name: 'Clear' }).click()
  await expect(main(page).getByText('3 of 4 tasks')).toBeVisible()
  await main(page).getByLabel('Status').selectOption('done')
  await expect(main(page).getByRole('row', { name: /TASK-1/ })).toBeVisible()
})

test('tasks board: the view is kept in the address; cards open the drawer; ?task= opens it directly', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await main(page).getByRole('tab', { name: 'Board' }).click()
  await expect(page).toHaveURL(/view=board/)
  await expect(main(page).getByRole('region', { name: /^Done/ })).toContainText('TASK-1')
  await main(page).getByRole('button', { name: /TASK-3/ }).click()
  await expect(drawer(page, 'Update the release notes')).toBeVisible()
  await expect(page).toHaveURL(/task=TASK-3/)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/task=/)
  await page.goto(sb.url + '/tasks?task=TASK-2')
  await expect(drawer(page, 'Run regression tests')).toBeVisible()
  await drawer(page, 'Run regression tests').getByRole('button', { name: 'Close' }).click()
  await expect(drawer(page, 'Run regression tests')).toBeHidden()
})

test('task drawer: moving a task is stored with a new revision', async ({ page }) => {
  await signIn(page, sb, '/tasks?task=TASK-3')
  await clickAnd(page, drawer(page, 'Update the release notes').getByRole('button', { name: 'In progress' }))
  expect((await tasks(sb)).find(t => t.code === 'TASK-3')).toMatchObject({ status: 'in_progress', revision: 2 })
  await expect(page.getByRole('status').filter({ hasText: 'TASK-3 moved to In progress' })).toBeVisible()
  await expect(drawer(page, 'Update the release notes')).toContainText('Revision 2')
  await expect(main(page).getByRole('row', { name: /TASK-3/ })).toContainText('In progress')
})

test('task drawer: a change made elsewhere is refused, explained, and the drawer shows the current task', async ({ page, watch }) => {
  watch.allow(/PATCH \/api\/tasks\/TASK-3 409/)
  await signIn(page, sb, '/tasks?task=TASK-3')
  const d = drawer(page, 'Update the release notes')
  await expect(d.getByRole('button', { name: 'In progress' })).toBeVisible()
  await apiFor(sb).raw('PATCH', '/api/tasks/TASK-3', { expected_revision: 1, status: 'blocked', blocked_reason: 'changed elsewhere' })
  await clickAnd(page, d.getByRole('button', { name: 'In progress' }))
  await expect(d.getByRole('alert')).toContainText('TASK-3 was changed elsewhere and is now Blocked (revision 2). Nothing was changed by this click.')
  await expect(d).toContainText('Revision 2')
  expect((await tasks(sb)).find(t => t.code === 'TASK-3')!.status).toBe('blocked')
})

test('task drawer: an unfinished prerequisite disables start and finish, and the server refuses too', async ({ page, watch }) => {
  watch.allow(/PATCH \/api\/tasks\/TASK-4 409/)
  await apiFor(sb).raw('POST', '/api/tasks/TASK-4/dependencies', { prerequisite_code: 'TASK-3' })
  await signIn(page, sb, '/tasks?task=TASK-4')
  const d = drawer(page, 'Prepare the rollback runbook')
  await expect(d.getByRole('button', { name: 'In progress' })).toBeDisabled()
  await expect(d.getByRole('button', { name: 'Done' })).toBeDisabled()
  await expect(d.getByText('Starting or finishing is disabled until TASK-3 is done.')).toBeVisible()
  expect((await apiFor(sb).raw('PATCH', '/api/tasks/TASK-4', { expected_revision: 1, status: 'done' })).status).toBe(409)
  await expect(main(page).getByRole('row').filter({ hasText: 'Prepare the rollback runbook' })).toContainText('Waiting for TASK-3')
})

test('task drawer: .ics download is a valid calendar entry; evidence and origin links open the meeting', async ({ page }) => {
  await signIn(page, sb, '/tasks?task=TASK-2')
  const d = drawer(page, 'Run regression tests')
  const dl = page.waitForEvent('download')
  await d.getByRole('button', { name: 'Download .ics' }).click()
  const ics = readFileSync((await (await dl).path())!, 'utf8')
  expect(ics).toContain('BEGIN:VCALENDAR'); expect(ics).toContain('TASK-2')
  await d.getByRole('link', { name: /Payments release follow-up \(synthetic\), Samiksha/ }).click()
  await expect(page).toHaveURL(/\/meetings\/2#s4$/)
  await expect(page.locator('[data-seg="s4"]')).toBeInViewport()
  await page.goto(sb.url + '/tasks?task=TASK-4')
  await drawer(page, 'Prepare the rollback runbook').getByRole('link', { name: 'Payments release follow-up (synthetic)', exact: true }).click()
  await expect(page).toHaveURL(/\/meetings\/2$/)
})

test('a reassigned task keeps its identity and records each revision', async () => {
  const t = await apiFor(sb).get<{ code: string; revisions: { revision: number; snapshot: { owner: string } }[] }>('/api/tasks/TASK-2')
  expect(t.revisions.map(r => [r.revision, r.snapshot.owner])).toEqual([[1, 'Priya'], [2, 'Samiksha']])
  expect((await tasks(sb)).filter(x => x.title === 'Run regression tests')).toHaveLength(1)
})

// ---- ask -----------------------------------------------------------------------------------------

test('ask: search without the model shows labelled passages with links; Enter sends', async ({ page }) => {
  await signIn(page, sb, '/ask')
  await main(page).getByLabel('Write an answer with the model').uncheck()
  // A question about the discussion: task-state questions are answered from the records instead.
  await main(page).getByLabel('Question').fill('What did Asha say about Stripe?')
  const res = page.waitForResponse(r => r.url().includes('/api/memory/query'))
  await main(page).getByLabel('Question').press('Enter')
  await res; await page.waitForLoadState('networkidle')
  await expect(main(page).getByText('Search results', { exact: true })).toBeVisible()
  await expect(main(page).getByText('No answer was written (the model is switched off).')).toBeVisible()
  await main(page).getByRole('link', { name: /segment s\d+/ }).first().click()
  await expect(page).toHaveURL(/\/meetings\/\d+#s\d+$/)
})

test('ask: a question nothing stored matches says so, distinct from a failed request, which can be retried', async ({ page, watch }) => {
  watch.allow(/memory\/query/)
  await signIn(page, sb, '/ask')
  await main(page).getByLabel('Write an answer with the model').uncheck()
  await main(page).getByLabel('Question').fill('xylophone quarterly zebra')
  await clickAnd(page, main(page).getByRole('button', { name: 'Ask' }), /memory\/query/)
  await expect(main(page).getByText('Nothing found in stored meetings')).toBeVisible()
  await page.route('**/api/memory/query', r => r.fulfill({ status: 500, body: '{"detail":"search index unavailable"}', contentType: 'application/json' }))
  await main(page).getByLabel('Question').fill('What did Asha say about Stripe?')
  await clickAnd(page, main(page).getByRole('button', { name: 'Ask' }), /memory\/query/)
  await expect(main(page).getByText('Request failed')).toBeVisible()
  await expect(main(page).getByText(/did not reach the meeting records: search index unavailable/)).toBeVisible()
  await page.unroute('**/api/memory/query')
  await clickAnd(page, main(page).getByRole('button', { name: 'Try again' }), /memory\/query/)
  await expect(main(page).getByText('Search results', { exact: true })).toBeVisible()
  await expect(main(page).getByText('Request failed')).toHaveCount(0)
  await expect(main(page).getByText('Nothing found in stored meetings')).toBeVisible() // the earlier turn stays
})

test('ask: an answer the records do not support is labelled as such, not as an answer', async ({ page }) => {
  await signIn(page, sb, '/ask')
  await page.route('**/api/memory/query', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    question: 'q', answer: 'Not found in stored meetings.', found: false, mode: 'llm_grounded', citations: [], current_state: [], note: 'model found no supporting passage',
    llm: { provider: 'ollama', model: 'qwen3:8b' },
    passages: [{ passage_id: 'P1', doc_type: 'segment', doc_id: '2:s3', text: 'Priya is travelling, so Samiksha takes over the regression tests.', meeting_id: 2, meeting_title: 'Payments release follow-up (synthetic)', meeting_date: '2026-10-22', seg_key: 's3', speaker: 'Asha', start_seconds: 8 }],
  }) }))
  await main(page).getByLabel('Question').fill('What budget was approved?')
  await clickAnd(page, main(page).getByRole('button', { name: 'Ask' }), /memory\/query/)
  await expect(main(page).getByText('Not supported by the meeting records')).toBeVisible()
  await expect(main(page).getByText('Closest passages (not an answer)')).toBeVisible()
  await expect(main(page).getByText('Answer from the meeting records')).toHaveCount(0)
})

// ---- follow-ups ----------------------------------------------------------------------------------

test('follow-ups: tabs are addressable; the agenda downloads and links to tasks, meetings and approvals', async ({ page }) => {
  await signIn(page, sb, '/follow-ups')
  const dl = page.waitForEvent('download')
  await main(page).getByRole('button', { name: 'Download as Markdown' }).click()
  expect(readFileSync((await (await dl).path())!, 'utf8')).toContain('TASK-3')
  await main(page).getByRole('link', { name: /TASK-3/ }).first().click()
  await expect(page).toHaveURL(/\/tasks\?task=TASK-3$/)
  await page.goto(sb.url + '/follow-ups')
  await main(page).getByRole('link', { name: 'Audio upload check (synthetic TTS)' }).click()
  await expect(page).toHaveURL(/\/approvals\/4$/)
  await page.goto(sb.url + '/follow-ups')
  await main(page).getByRole('tab', { name: 'Reminders' }).click()
  await expect(page).toHaveURL(/tab=reminders/)
  await main(page).getByRole('tab', { name: 'Agenda' }).click()
  await expect(page).not.toHaveURL(/tab=/)
})

test('calendar: export contains every approved due date', async ({ page }) => {
  await signIn(page, sb, '/follow-ups?tab=calendar')
  const dl = page.waitForEvent('download')
  await main(page).getByRole('button', { name: 'Export calendar (.ics)' }).click()
  const ics = readFileSync((await (await dl).path())!, 'utf8')
  for (const code of ['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4']) expect(ics).toContain(code)
  await expect(main(page).getByRole('row')).toHaveCount(5)
})

test('reminders: draft in a dialog, approve, cancel; each state is stored', async ({ page }) => {
  await signIn(page, sb, '/follow-ups?tab=reminders')
  const n = (await reminders(sb)).length
  await main(page).getByRole('button', { name: 'New reminder' }).click()
  const d = page.getByRole('dialog', { name: 'New reminder' })
  await d.getByLabel('Task').selectOption('TASK-3')
  await d.getByLabel('When').fill('2026-10-30T09:30')
  await clickAnd(page, d.getByRole('button', { name: 'Draft reminder' }))
  await expect(d).toBeHidden()
  const mine = (await reminders(sb)).find(r => r.delivery_state === 'draft')!
  expect((await reminders(sb)).length).toBe(n + 1)
  const rowOf = () => main(page).getByRole('row').filter({ hasText: 'Draft, not scheduled' })
  await clickAnd(page, rowOf().getByRole('button', { name: 'Approve' }))
  expect((await reminders(sb)).find(r => r.id === mine.id)!.delivery_state).toBe('scheduled')
  await clickAnd(page, main(page).getByRole('row').filter({ hasText: '30 Oct' }).getByRole('button', { name: 'Cancel' }))
  expect((await reminders(sb)).find(r => r.id === mine.id)!.delivery_state).toBe('cancelled')
})

test('reminders: an email reminder without recipients is refused inside the dialog', async ({ page, watch }) => {
  watch.allow(/POST \/api\/reminders 422/)
  await signIn(page, sb, '/follow-ups?tab=reminders')
  await main(page).getByRole('button', { name: 'New reminder' }).click()
  const d = page.getByRole('dialog', { name: 'New reminder' })
  await d.getByLabel('Task').selectOption('TASK-3')
  await d.getByLabel('When').fill('2026-10-30T09:30')
  await d.getByLabel('Channel').selectOption('email')
  await clickAnd(page, d.getByRole('button', { name: 'Draft reminder' }))
  await expect(d.getByRole('alert')).toContainText('email reminders need explicit recipients')
  await expect(d).toBeVisible()
})

test('reminders: a due email reminder without SMTP is shown as not sent; in-app ones are delivered and marked read', async ({ page }) => {
  await signIn(page, sb, '/follow-ups?tab=reminders')
  for (const [task, channel] of [['TASK-3', 'email'], ['TASK-4', 'in_app']]) {
    await main(page).getByRole('button', { name: 'New reminder' }).click()
    const d = page.getByRole('dialog', { name: 'New reminder' })
    await d.getByLabel('Task').selectOption(task)
    await d.getByLabel('When').fill('2026-10-20T09:00')
    await d.getByLabel('Channel').selectOption(channel)
    if (channel === 'email') await d.getByLabel('Recipients').fill('meera@example.com')
    await clickAnd(page, d.getByRole('button', { name: 'Draft reminder' }))
    await clickAnd(page, main(page).getByRole('row').filter({ hasText: 'Draft, not scheduled' }).getByRole('button', { name: 'Approve' }))
  }
  await clickAnd(page, main(page).getByRole('button', { name: 'Deliver due reminders now' }))
  await expect(main(page).getByRole('status').filter({ hasText: 'delivered in the app just now' })).toBeVisible()
  const email = (await reminders(sb)).find(r => r.channel === 'email')!
  expect(email.delivery_state).toBe('failed')
  const emailRow = main(page).getByRole('row').filter({ hasText: 'meera@example.com' })
  await expect(emailRow).toContainText('Not sent')
  await expect(emailRow).toContainText('SMTP not configured; not sent')
  await expect(emailRow).not.toContainText('Delivered')
  await main(page).getByRole('tab', { name: /Notifications/ }).click()
  const notes = await apiFor(sb).get<{ read: boolean }[]>('/api/notifications')
  const unread = notes.filter(n => !n.read).length
  expect(unread).toBeGreaterThan(0)
  await clickAnd(page, main(page).getByRole('button', { name: 'Mark read' }).first())
  expect((await apiFor(sb).get<{ read: boolean }[]>('/api/notifications')).filter(n => !n.read).length).toBe(unread - 1)
})
