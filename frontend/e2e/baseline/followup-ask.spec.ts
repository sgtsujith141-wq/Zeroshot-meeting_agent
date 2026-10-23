// BASELINE AUDIT (UI at 10deb16): calendar & reminders, agenda, memory Q&A, diagnostics.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type R = { id: number; task_code: string; channel: string; delivery_state: string; last_error: string | null }
const settle = (page: Page) => page.waitForLoadState('networkidle')
const reminders = (sb: Sandbox) => apiFor(sb).get<R[]>('/api/reminders')

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'base-fa') })
test.afterEach(async () => { await sb.stop() })

test('F01 calendar export contains every approved due date', async ({ page }) => {
  await signIn(page, sb, '/follow-up')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export calendar (.ics)' }).click()
  const ics = readFileSync((await (await dl).path())!, 'utf8')
  expect(ics).toContain('BEGIN:VCALENDAR')
  for (const code of ['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4']) expect(ics).toContain(code)
})

test('F02 draft an in-app reminder, approve it, then cancel it', async ({ page }) => {
  await signIn(page, sb, '/follow-up')
  const n = (await reminders(sb)).length
  await page.getByRole('combobox', { name: 'Task', exact: true }).selectOption('TASK-3')
  await page.getByLabel('When (task time zone)').fill('2026-10-30T09:30')
  await clickAnd(page, page.getByRole('button', { name: 'Draft reminder' }))
  let r = await reminders(sb)
  expect(r.length).toBe(n + 1)
  const mine = r.find(x => x.delivery_state === 'draft')!
  await clickAnd(page, page.getByRole('row').filter({ hasText: 'Draft' }).getByRole('button', { name: 'Approve' }))
  r = await reminders(sb)
  expect(r.find(x => x.id === mine.id)!.delivery_state).toBe('scheduled')
  await clickAnd(page, page.getByRole('row').filter({ hasText: 'Oct 30' }).getByRole('button', { name: 'Cancel' }))
  expect((await reminders(sb)).find(x => x.id === mine.id)!.delivery_state).toBe('cancelled')
})

test('F03 an email reminder without recipients is refused with the reason', async ({ page, watch }) => {
  watch.allow(/POST \/api\/reminders 422/)
  await signIn(page, sb, '/follow-up')
  await page.getByRole('combobox', { name: 'Task', exact: true }).selectOption('TASK-3')
  await page.getByLabel('When (task time zone)').fill('2026-10-30T09:30')
  await page.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('email')
  await clickAnd(page, page.getByRole('button', { name: 'Draft reminder' }))
  await expect(page.getByRole('alert')).toContainText(/recipients/)
})

test('F04 an approved email reminder is never reported as delivered without SMTP', async ({ page }) => {
  await signIn(page, sb, '/follow-up')
  await page.getByRole('combobox', { name: 'Task', exact: true }).selectOption('TASK-3')
  await page.getByLabel('When (task time zone)').fill('2026-10-20T09:30')
  await page.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('email')
  await page.getByLabel('Recipients (email only)').fill('meera@example.com')
  await clickAnd(page, page.getByRole('button', { name: 'Draft reminder' }))
  await clickAnd(page, page.getByRole('row').filter({ hasText: 'Draft' }).getByRole('button', { name: 'Approve' }))
  await clickAnd(page, page.getByRole('button', { name: 'Deliver due reminders now' }))
  const email = (await reminders(sb)).find(x => x.channel === 'email')!
  expect(email.delivery_state).not.toBe('delivered')
  await expect(page.getByRole('row').filter({ hasText: 'meera@example.com' })).not.toContainText('Delivered')
})

test('F05+F06 delivering due reminders now creates a notification that can be marked read', async ({ page }) => {
  await signIn(page, sb, '/follow-up')
  await page.getByRole('combobox', { name: 'Task', exact: true }).selectOption('TASK-4')
  await page.getByLabel('When (task time zone)').fill('2026-10-20T09:00')
  await clickAnd(page, page.getByRole('button', { name: 'Draft reminder' }))
  await clickAnd(page, page.getByRole('row').filter({ hasText: 'Draft' }).getByRole('button', { name: 'Approve' }))
  await clickAnd(page, page.getByRole('button', { name: 'Deliver due reminders now' }))
  await expect(page.getByText(/reminder\(s\) delivered now/)).toBeVisible()
  const notes = await apiFor(sb).get<{ id: number; read: boolean }[]>('/api/notifications')
  const unread = notes.filter(n => !n.read).length
  expect(unread).toBeGreaterThan(0)
  await clickAnd(page, page.getByRole('button', { name: 'Mark read' }).first())
  expect((await apiFor(sb).get<{ read: boolean }[]>('/api/notifications')).filter(n => !n.read).length).toBe(unread - 1)
})

test('F07 the agenda downloads as Markdown and links to source meetings', async ({ page }) => {
  await signIn(page, sb, '/agenda')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download as Markdown' }).click()
  const md = readFileSync((await (await dl).path())!, 'utf8')
  expect(md).toContain('TASK-3')
  await page.getByRole('link', { name: /from Payments release planning/ }).first().click()
  await expect(page).toHaveURL(/\/meetings\/1$/)
})

test('Q01 asking without the model returns stored passages with working citations', async ({ page }) => {
  await signIn(page, sb, '/memory')
  await page.getByLabel('Write an answer with the model').uncheck()
  await page.getByLabel('Question').fill('Who owns the regression tests?')
  await clickAnd(page, page.getByRole('button', { name: 'Ask' }))
  await expect(page.getByText(/No model answer; the closest stored passages are shown|Search only/)).toBeVisible()
  await page.getByRole('link', { name: /segment s\d+/ }).first().click()
  await expect(page).toHaveURL(/\/meetings\/\d+#s\d+$/)
})

test('Q02 a question nothing stored can answer says so', async ({ page }) => {
  await signIn(page, sb, '/memory')
  await page.getByLabel('Write an answer with the model').uncheck()
  await page.getByLabel('Question').fill('xylophone quarterly budget zebra')
  await clickAnd(page, page.getByRole('button', { name: 'Ask' }))
  await expect(page.getByText(/not found in stored meetings/i).first()).toBeVisible()
})

test('Q05 a failed request is shown as a failure, distinct from "not found"', async ({ page, watch }) => {
  watch.allow(/memory\/query/)
  await signIn(page, sb, '/memory')
  await page.route('**/api/memory/query', r => r.fulfill({ status: 500, body: '{"detail":"search index unavailable"}', contentType: 'application/json' }))
  await page.getByLabel('Question').fill('Who owns the regression tests?')
  await clickAnd(page, page.getByRole('button', { name: 'Ask' }))
  await expect(page.getByRole('alert')).toContainText('search index unavailable')
  await expect(page.getByText(/not found in stored meetings/i)).toHaveCount(0)
})

test('D01 diagnostics shows the configured services', async ({ page }) => {
  await signIn(page, sb, '/diagnostics')
  await expect(page.getByText('Local Ollama')).toBeVisible()
  await expect(page.getByText(/no API key/).first()).toBeVisible()
})
