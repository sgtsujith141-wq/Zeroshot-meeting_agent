// The remaining question types (acceptance, two kinds of cancellation, unverified reference,
// speech addressed to the assistant, missing prerequisite). A sandbox meeting is seeded with
// recorded test events (provider "test-fixture"); the real reconciliation rules raise the
// questions and every answer is checked through the API.
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type Item = { key: string; owner: string | null; owner_status: string; operation: string; state: string; excluded?: boolean; existing_task_id: string | null; depends_on: { key: string }[] }
type CS = { proposal: { items: Item[]; clarifications: { kind: string; item_keys: string[]; answer: { choice: string } | null }[] } }

const main = (page: Page) => page.getByRole('main')
const q = (page: Page, kind: string) => main(page).locator(`li[data-question="${kind}"]`).first()
const undo = (page: Page, label: string) => clickAnd(page, main(page).getByRole('listitem').filter({ hasText: label }).getByRole('button', { name: 'Change answer' }))

let sb: Sandbox
let mid: number
const cs = () => apiFor(sb).get<CS>(`/api/meetings/${mid}/changeset`)
const item = async (key: string) => (await cs()).proposal.items.find(i => i.key === key)!
const answer = async (kind: string) => (await cs()).proposal.clarifications.find(c => c.kind === kind)?.answer?.choice ?? null

test.beforeEach(async ({ page }) => {
  sb = await startSandbox('demo', 'questions', { SEED_QUESTIONS: '1' })
  mid = sb.seeded!.meeting_id
  expect(sb.seeded!.kinds).toEqual(expect.arrayContaining(['pending_acceptance', 'ambiguous_cancellation_existing', 'ambiguous_cancellation_new',
    'unverified_reference', 'instruction_to_assistant', 'missing_prerequisite']))
  await signIn(page, sb, `/approvals/${mid}`)
})
test.afterEach(async () => { await sb.stop() })

test('the seeded meeting is labelled as a recorded test fixture', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: /^Fixture: every question type/ })).toBeVisible()
  const m = await apiFor(sb).get<{ llm_runs: { provider: string }[] }>(`/api/meetings/${mid}`)
  expect(m.llm_runs.every(r => r.provider === 'test-fixture')).toBe(true)
})

test('"Yes, Rahul accepted" records the acceptance and makes Rahul the owner', async ({ page }) => {
  await clickAnd(page, q(page, 'pending_acceptance').getByRole('button', { name: 'Yes, Rahul accepted' }))
  expect(await answer('pending_acceptance')).toBe('accepted')
  expect(await item('deploy-checklist')).toMatchObject({ owner: 'Rahul', owner_status: 'accepted_per_organiser' })
})

test('cancellation of an existing task: "Keep the task" keeps it; "Cancel the whole task" proposes cancelling it', async ({ page }) => {
  await clickAnd(page, q(page, 'ambiguous_cancellation_existing').getByRole('button', { name: 'Keep the task' }))
  expect(await answer('ambiguous_cancellation_existing')).toBe('keep_task')
  expect((await item('TASK-4')).operation).not.toBe('cancel')
  await undo(page, 'Cancel the task or only a plan?')
  await clickAnd(page, q(page, 'ambiguous_cancellation_existing').getByRole('button', { name: 'Cancel the whole task' }))
  expect(await answer('ambiguous_cancellation_existing')).toBe('cancel_task')
  expect((await item('TASK-4')).operation).toBe('cancel')
  await expect(page.locator('tr[data-item="TASK-4"]')).toContainText('Cancel task')
  await expect(page.locator('tr[data-item="TASK-4"]')).toContainText('Status: Cancelled')
})

test('cancellation of a new item: "It is cancelled" drops it; "Keep it" keeps it as a new task', async ({ page }) => {
  await clickAnd(page, q(page, 'ambiguous_cancellation_new').getByRole('button', { name: 'It is cancelled' }))
  expect(await answer('ambiguous_cancellation_new')).toBe('cancel')
  expect((await item('beta-email')).state).toBe('cancelled')
  await undo(page, 'Is it cancelled?')
  await clickAnd(page, q(page, 'ambiguous_cancellation_new').getByRole('button', { name: 'Keep it' }))
  expect(await answer('ambiguous_cancellation_new')).toBe('keep')
  expect((await item('beta-email')).operation).toBe('create')
})

test('unverified link: "Yes, that task", "A new task" and "Drop it" are each stored with their effect', async ({ page }) => {
  await clickAnd(page, q(page, 'unverified_reference').getByRole('button', { name: 'Yes, that task' }))
  expect(await answer('unverified_reference')).toBe('confirm')
  await undo(page, 'Is this the linked task?')
  await clickAnd(page, q(page, 'unverified_reference').getByRole('button', { name: 'A new task' }))
  expect(await answer('unverified_reference')).toBe('new')
  expect((await item('TASK-3')).existing_task_id).toBeNull()
  await undo(page, 'Is this the linked task?')
  await clickAnd(page, q(page, 'unverified_reference').getByRole('button', { name: 'Drop it' }))
  expect(await answer('unverified_reference')).toBe('drop')
  expect((await item('TASK-3')).excluded).toBe(true)
})

test('speech addressed to the assistant: "Not a team action" excludes it; "It is a genuine action" keeps it', async ({ page }) => {
  await expect(q(page, 'instruction_to_assistant')).toContainText('comes only from speech addressed to the assistant')
  await clickAnd(page, q(page, 'instruction_to_assistant').getByRole('button', { name: 'Not a team action' }))
  expect(await answer('instruction_to_assistant')).toBe('drop')
  expect((await item('email-customer')).excluded).toBe(true)
  // The item is now excluded, so its answer is changed from the item's details.
  await page.locator('tr[data-item="email-customer"]').getByRole('button', { name: 'Email the customer' }).click()
  const d = page.getByRole('dialog', { name: 'Email the customer' })
  await clickAnd(page, d.getByRole('button', { name: 'Change answer' }))
  await d.getByRole('button', { name: 'Close' }).click()
  await clickAnd(page, q(page, 'instruction_to_assistant').getByRole('button', { name: 'It is a genuine action' }))
  expect(await answer('instruction_to_assistant')).toBe('keep')
  expect((await item('email-customer')).excluded).toBe(false)
})

test('missing prerequisite: asked once the item is known to be new; "Remove this dependency" drops it', async ({ page }) => {
  await expect(q(page, 'missing_prerequisite')).toHaveCount(0) // deferred behind the existence question
  await clickAnd(page, main(page).locator('li[data-question="possible_existing_match"]').filter({ hasText: 'Run the load test' }).getByRole('button', { name: 'It is a new task' }))
  await expect(q(page, 'missing_prerequisite')).toContainText('depends on “vendor-contract”, which is not a known task')
  await clickAnd(page, q(page, 'missing_prerequisite').getByRole('button', { name: 'Remove this dependency' }))
  expect(await answer('missing_prerequisite')).toBe('drop_dependency')
  expect((await item('load-test')).depends_on.map(d => d.key)).not.toContain('vendor-contract')
})
