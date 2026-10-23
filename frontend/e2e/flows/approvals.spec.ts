// Approvals: every answer type, the change table vs what the backend applies, stale and
// concurrent states, duplicate approval, reject, decisions. Each test gets its own sandbox.
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type Item = { key: string; title: string; owner: string | null; owner_status: string; excluded?: boolean; existing_task_id: string | null; operation: string; state: string
  depends_on: { key: string }[]; history: { summary: string }[]; deadline: { date: string | null }; priority: { value: string | null } }
type CS = { id: number; state: string; version: number; proposal_hash: string; ledger_snapshot: { code: string; revision: number }[]
  organizer_edits: { answers?: Record<string, { choice: string; value: string | null } | null>; items?: Record<string, Record<string, unknown>> } | null
  proposal: { items: Item[]; clarifications: { kind: string; item_keys: string[]; answer: { choice: string; value: string | null } | null }[]; decisions_review: { id: number; include: boolean }[] }
  applied_result: { created?: Record<string, string>; updated?: string[]; completed?: string[] } }
type T = { code: string; title: string; owner: string | null; due_date: string | null; status: string; revision: number; priority: string | null; prerequisites: { code: string }[] }

const cs = (sb: Sandbox, m: number) => apiFor(sb).get<CS>(`/api/meetings/${m}/changeset`)
const answer = (c: CS, key: string) => c.proposal.clarifications.find(q => q.item_keys[0] + '|' + q.kind === key)?.answer ?? null
const item = (c: CS, key: string) => c.proposal.items.find(i => i.key === key)!
const tasks = (sb: Sandbox) => apiFor(sb).get<T[]>('/api/tasks')
const main = (page: Page) => page.getByRole('main')
const q = (page: Page, kind: string) => main(page).locator(`li[data-question="${kind}"]`).first()
const row = (page: Page, key: string) => page.locator(`tr[data-item="${key}"]`)
const btn = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true })
const approveBtn = (page: Page) => btn(page, 'Approve')
const drawer = (page: Page, title: string) => page.getByRole('dialog', { name: title })
// Change lines read "Deadline: 26 October → 27 October"; the arrow is followed by screen-reader text.
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
const to = ' changes to '

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'approvals') })
test.afterEach(async () => { await sb.stop() })

async function openRow(page: Page, key: string, title: string) {
  await row(page, key).getByRole('button', { name: title }).click()
  await expect(drawer(page, title)).toBeVisible()
  return drawer(page, title)
}
async function exclude(page: Page, key: string, title: string) {
  const d = await openRow(page, key, title)
  await clickAnd(page, d.getByRole('button', { name: 'Exclude from approval' }))
  await d.getByRole('button', { name: 'Close' }).click()
}
async function answerM4(page: Page) {
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await clickAnd(page, btn(page, 'Fri 30 Oct 2026'))
  await exclude(page, 'mobile-app-launch-sync', 'Sync on mobile app launch')
  await expect(approveBtn(page)).toBeEnabled()
}

test('list: Waiting and All tabs match the API; a row opens its approval', async ({ page }) => {
  await signIn(page, sb, '/approvals')
  await expect(main(page).getByRole('tab', { name: 'Waiting 2' })).toHaveAttribute('aria-selected', 'true')
  await expect(main(page).getByRole('row')).toHaveCount(3)
  await main(page).getByRole('tab', { name: 'All 4' }).click()
  await expect(main(page).getByRole('row')).toHaveCount(5)
  await main(page).getByRole('row', { name: /Audio upload check/ }).click()
  await expect(page).toHaveURL(/\/approvals\/4$/)
})

test('approval is disabled while questions are open, and the bar says what to do', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await expect(approveBtn(page)).toBeDisabled()
  await expect(main(page).getByText('Answer 4 open questions, or exclude their items.')).toBeVisible()
})

test('existing-task question: "Same as TASK-3" links it, "Change answer" undoes it, "It is a new task" keeps it separate', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  expect(answer(await cs(sb, 4), 'release-notes|possible_existing_match')).toEqual({ choice: 'link', value: 'TASK-3' })
  await expect(row(page, 'release-notes')).toContainText('TASK-3')
  await clickAnd(page, main(page).getByRole('listitem').filter({ hasText: 'same task as TASK-3' }).getByRole('button', { name: 'Change answer' }))
  expect(answer(await cs(sb, 4), 'release-notes|possible_existing_match')).toBeNull()
  await clickAnd(page, btn(page, 'It is a new task'))
  expect(item(await cs(sb, 4), 'release-notes')).toMatchObject({ existing_task_id: null })
  expect(answer(await cs(sb, 4), 'release-notes|possible_existing_match')?.choice).toBe('new')
})

test('deadline question: candidate date, a typed date, and no deadline are each stored', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await clickAnd(page, btn(page, 'Fri 30 Oct 2026'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-10-30' })
  await expect(row(page, 'login-screen')).toContainText('Deadline: 30 October')
  const undo = () => clickAnd(page, main(page).getByRole('listitem').filter({ hasText: /^Which date\?/ }).getByRole('button', { name: 'Change answer' }))
  await undo()
  await q(page, 'ambiguous_deadline').getByLabel('Due date').fill('2026-11-02')
  await clickAnd(page, btn(page, 'Use this date'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-11-02' })
  await undo()
  await clickAnd(page, btn(page, 'No deadline'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')?.choice).toBe('no_deadline')
})

test('owner question: Set owner and Leave unassigned are stored', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await q(page, 'missing_owner').getByLabel('Owner').fill('Asha')
  await clickAnd(page, q(page, 'missing_owner').getByRole('button', { name: 'Set owner' }))
  expect(answer(await cs(sb, 4), 'mobile-app-launch-sync|missing_owner')).toEqual({ choice: 'set_owner', value: 'Asha' })
  await expect(row(page, 'mobile-app-launch-sync')).toContainText('Asha')
  await clickAnd(page, main(page).getByRole('listitem').filter({ hasText: 'owner Asha' }).getByRole('button', { name: 'Change answer' }))
  await clickAnd(page, q(page, 'missing_owner').getByRole('button', { name: 'Leave unassigned' }))
  expect(answer(await cs(sb, 4), 'mobile-app-launch-sync|missing_owner')?.choice).toBe('unassigned')
})

test('speaker question: Map speaker stores the identity only on an explicit mapping', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await q(page, 'unmapped_speaker').getByPlaceholder('Who is SPEAKER_00?').fill('Kavya')
  await clickAnd(page, btn(page, 'Map speaker'), /^PUT /)
  const m = await apiFor(sb).get<{ participants: { speaker_label: string; display_name: string | null; confirmed_identity: boolean }[] }>('/api/meetings/4')
  expect(m.participants[0]).toMatchObject({ speaker_label: 'SPEAKER_00', display_name: 'Kavya', confirmed_identity: true })
  await expect(page.getByRole('status').filter({ hasText: 'SPEAKER_00 is now Kavya' })).toBeVisible()
})

test('P0: an unrelated answer never maps SPEAKER_00, every owner traces to a spoken name, and the change is announced', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  expect(item(await cs(sb, 4), 'login-screen').owner).toBeNull()
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  const m = await apiFor(sb).get<{ participants: { display_name: string | null }[]; segments: { text: string }[] }>('/api/meetings/4')
  expect(m.participants.every(p => p.display_name === null)).toBe(true)
  const v2 = await cs(sb, 4)
  for (const it of v2.proposal.items.filter(i => i.owner)) {
    expect(['named', 'confirmed', 'accepted_per_organiser']).toContain(it.owner_status)
    expect(m.segments.some(s => s.text.includes(it.owner!))).toBe(true)
  }
  expect(item(v2, 'login-screen').history.map(h => h.summary).join(' | ')).toMatch(/kept named owner Kavya/)
  const notice = page.getByRole('status').filter({ hasText: 'What changed after your last action' })
  await expect(notice).toContainText('“Finish the login screen”: owner Unassigned → Kavya')
  await expect(notice).toContainText('No longer asked: Who is SPEAKER_00?')
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)
})

test('P0: an answer the server stops using is surfaced, blocks approval, and "Leave it unassigned" honours it', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await clickAnd(page, q(page, 'unmapped_speaker').getByRole('button', { name: 'Leave unassigned' }))
  let c = await cs(sb, 4)
  expect(c.organizer_edits?.answers?.['login-screen|unmapped_speaker']).toMatchObject({ choice: 'unassigned' })
  expect(item(c, 'login-screen').owner).toBe('Kavya') // the server proposes the spoken name instead
  const orphan = page.getByRole('alert').filter({ hasText: 'earlier answer no longer applies' })
  await expect(orphan).toContainText('Your answer “leave unassigned” for “Finish the login screen” (who is this speaker?) was not applied. It is now proposed with owner Kavya')
  // Answer the other questions; approval must stay blocked until the organiser decides.
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await clickAnd(page, btn(page, 'Fri 30 Oct 2026'))
  await exclude(page, 'mobile-app-launch-sync', 'Sync on mobile app launch')
  await expect(approveBtn(page)).toBeDisabled()
  await expect(main(page).getByText('Decide on 1 earlier answer that no longer applies.')).toBeVisible()
  await clickAnd(page, orphan.getByRole('button', { name: 'Leave it unassigned' }))
  c = await cs(sb, 4)
  expect(item(c, 'login-screen').owner).toBeNull()
  expect(c.organizer_edits?.answers?.['login-screen|unmapped_speaker'] ?? null).toBeNull()
  await expect(orphan).toHaveCount(0)
  await expect(row(page, 'login-screen')).toContainText('Owner: Unassigned')
  await expect(approveBtn(page)).toBeEnabled()
})

test('P0: "Keep the current proposal" accepts the spoken owner and removes the stale answer', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await clickAnd(page, q(page, 'unmapped_speaker').getByRole('button', { name: 'Leave unassigned' }))
  await clickAnd(page, page.getByRole('alert').getByRole('button', { name: 'Keep the current proposal' }))
  const c = await cs(sb, 4)
  expect(item(c, 'login-screen').owner).toBe('Kavya')
  expect(c.organizer_edits?.answers?.['login-screen|unmapped_speaker'] ?? null).toBeNull()
  await expect(page.getByRole('alert').filter({ hasText: 'no longer applies' })).toHaveCount(0)
})

test('details drawer: effect, evidence that opens the transcript at the line, steps; Esc closes', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const d = await openRow(page, 'login-screen', 'Finish the login screen')
  await expect(d.getByRole('heading', { name: 'What approval will change once answered' })).toBeVisible()
  await expect(d.getByText('Kavya, please finish the login screen by friday.')).toBeVisible()
  await expect(d.locator('li[data-question="ambiguous_deadline"]')).toBeVisible()
  await expect(d.getByText(/How this was worked out/)).toBeVisible()
  await d.getByRole('button', { name: 'Show s2 in transcript' }).first().click()
  const t = drawer(page, 'Transcript')
  await expect(t).toBeVisible()
  await expect(t.locator('[data-seg="s2"]')).toBeInViewport()
  await expect(t.locator('[data-seg="s2"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await expect(t).toBeHidden()
  const d2 = await openRow(page, 'login-screen', 'Finish the login screen')
  await page.keyboard.press('Escape')
  await expect(d2).toBeHidden()
})

test('drawer edits: owner, due date and priority are stored; Cancel discards; existing tasks cannot be renamed', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  let d = await openRow(page, 'release-notes', 'Start the release notes')
  await d.getByRole('button', { name: 'Edit' }).click()
  await d.getByLabel('Owner').fill('Priya')
  await d.getByRole('button', { name: 'Cancel' }).click()
  expect(item(await cs(sb, 4), 'release-notes').owner).toBe('Meera')
  await d.getByRole('button', { name: 'Edit' }).click()
  await d.getByLabel('Title').fill('Draft the release notes')
  await d.getByLabel('Owner').fill('Priya')
  await d.getByLabel('Due date').fill('2026-11-05')
  await d.getByLabel('Priority').selectOption('low')
  await clickAnd(page, d.getByRole('button', { name: 'Save edits' }))
  const it = item(await cs(sb, 4), 'release-notes')
  expect(it).toMatchObject({ title: 'Draft the release notes', owner: 'Priya', deadline: expect.objectContaining({ date: '2026-11-05' }), priority: expect.objectContaining({ value: 'low' }) })
  await drawer(page, 'Draft the release notes').getByRole('button', { name: 'Close' }).click() // the drawer shows the new title
  // Once it is linked to an existing task the title field is gone, because approval never renames.
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  d = await openRow(page, 'release-notes', 'Update the release notes')
  await d.getByRole('button', { name: 'Edit' }).click()
  await expect(d.getByLabel('Title')).toHaveCount(0)
  await expect(d.getByText('The title of an existing task cannot be changed here')).toBeVisible()
})

test('exclude and include again from the drawer; the excluded item\'s question disappears and comes back', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await exclude(page, 'mobile-app-launch-sync', 'Sync on mobile app launch')
  expect(item(await cs(sb, 4), 'mobile-app-launch-sync').excluded).toBe(true)
  await expect(q(page, 'missing_owner')).toHaveCount(0)
  await expect(row(page, 'mobile-app-launch-sync')).toContainText('Excluded')
  const d = await openRow(page, 'mobile-app-launch-sync', 'Sync on mobile app launch')
  await clickAnd(page, d.getByRole('button', { name: 'Include again' }))
  expect(item(await cs(sb, 4), 'mobile-app-launch-sync').excluded).toBe(false)
  await d.getByRole('button', { name: 'Close' }).click()
  await expect(q(page, 'missing_owner')).toBeVisible()
})

test('a proposed dependency can be removed from the drawer', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const d = await openRow(page, 'release-notes', 'Start the release notes')
  await clickAnd(page, d.getByRole('button', { name: 'Remove dependency on Payment API is done and merged' }))
  expect(item(await cs(sb, 4), 'release-notes').depends_on).toEqual([])
})

test('approving applies exactly the changes the table shows, and the page shows the recorded result', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  await answerM4(page)
  const before = await tasks(sb)
  // What the table says will be written.
  await expect(row(page, 'login-screen')).toContainText('Will apply')
  await expect(row(page, 'login-screen')).toContainText('Owner: Kavya')
  await expect(row(page, 'login-screen')).toContainText(`Deadline: ${fmt('2026-10-30')}`)
  // Linking to TASK-3 also applies the meeting's stated priority, so that is shown too.
  await expect(row(page, 'release-notes')).toContainText('TASK-3: change priority')
  await expect(row(page, 'release-notes')).toContainText(`Priority: Medium→${to}High`)
  await expect(main(page).getByText('Approving applies 1 new task, 1 update, exactly as listed.')).toBeVisible()
  const r = await clickAnd(page, approveBtn(page))
  expect(r.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Audio upload check (synthetic TTS)' })).toBeVisible()
  await expect(main(page).getByText('Approved and applied')).toBeVisible()
  const c = await cs(sb, 4)
  expect(c.state).toBe('APPLIED')
  const after = await tasks(sb)
  const created = after.filter(t => !before.some(b => b.code === t.code))
  expect(created.map(t => [t.title, t.owner, t.due_date, t.status])).toEqual([['Finish the login screen', 'Kavya', '2026-10-30', 'todo']])
  const t3b = before.find(t => t.code === 'TASK-3')!, t3a = after.find(t => t.code === 'TASK-3')!
  const visible = (t: T) => ({ title: t.title, owner: t.owner, due: t.due_date, status: t.status, deps: t.prerequisites.map(p => p.code) })
  expect(visible(t3a)).toEqual(visible(t3b)) // shown as unchanged, and unchanged
  expect([t3a.priority, t3a.revision]).toEqual(['high', t3b.revision + 1]) // shown as Medium → High
  // After approval the table switches to what the recorded revisions say.
  await expect(row(page, 'login-screen')).toContainText(`Created ${created[0].code}`)
  await expect(row(page, 'release-notes')).toContainText('Updated TASK-3')
  await expect(main(page).getByRole('columnheader', { name: 'What approval changed' })).toBeVisible()
  await expect(approveBtn(page)).toHaveCount(0)
})

test('P0: after a re-check, every change approval makes to TASK-2 is flagged, and nothing else', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/approvals/3')
  const before = (await tasks(sb)).find(t => t.code === 'TASK-2')!
  // The stored proposal predates the current rules: approving it is refused, then recovered.
  const first = await clickAnd(page, approveBtn(page))
  expect(first.status()).toBe(409)
  const stale = page.getByRole('status').filter({ hasText: 'This proposal changed on the server since you loaded it' })
  await expect(stale).toBeVisible()
  await expect(approveBtn(page)).toBeDisabled()
  await clickAnd(page, stale.getByRole('button', { name: 'Re-check against the current board' }))
  await expect(page.getByRole('status').filter({ hasText: 'What changed after your last action' })).toContainText('“Run regression tests”')
  const r2 = row(page, 'TASK-2')
  await expect(r2).toContainText('TASK-2: move deadline, change priority')
  await expect(r2).toContainText(`Deadline: ${fmt('2026-10-26')}→${to}${fmt('2026-10-27')}`)
  await expect(r2).toContainText(`Priority: Not set→${to}High`)
  const d = await openRow(page, 'TASK-2', 'Run regression tests')
  await expect(d.getByText('Approval keeps the existing dependency on TASK-1; it never removes dependencies.')).toBeVisible()
  await d.getByRole('button', { name: 'Close' }).click()
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 3)).state).toBe('APPLIED')
  const after = (await tasks(sb)).find(t => t.code === 'TASK-2')!
  expect({ due: after.due_date, priority: after.priority, owner: after.owner, deps: after.prerequisites.map(p => p.code) })
    .toEqual({ due: '2026-10-27', priority: 'high', owner: before.owner, deps: before.prerequisites.map(p => p.code) })
})

test('approving meeting 4 then meeting 3: the stale board is detected and recovered with current data', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/approvals/4')
  await answerM4(page)
  await clickAnd(page, approveBtn(page))
  await page.goto(sb.url + '/approvals/3'); await page.waitForLoadState('networkidle')
  const stale = page.getByRole('status').filter({ hasText: 'The task board changed after this proposal was checked' })
  await expect(stale).toBeVisible()
  await expect(approveBtn(page)).toBeDisabled()
  await clickAnd(page, stale.getByRole('button', { name: 'Re-check against the current board' }))
  const live = (await tasks(sb)).filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).map(t => `${t.code}@${t.revision}`).sort()
  expect((await cs(sb, 3)).ledger_snapshot.map(t => `${t.code}@${t.revision}`).sort()).toEqual(live)
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 3)).state).toBe('APPLIED')
})

test('approving meeting 3 then meeting 4: the re-check keeps every answer and exclusion', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/approvals/4')
  await answerM4(page)
  await page.goto(sb.url + '/approvals/3'); await page.waitForLoadState('networkidle')
  if ((await clickAnd(page, approveBtn(page))).status() === 409) {
    await clickAnd(page, btn(page, 'Re-check against the current board'))
    await clickAnd(page, approveBtn(page))
  }
  expect((await cs(sb, 3)).state).toBe('APPLIED')
  await page.goto(sb.url + '/approvals/4'); await page.waitForLoadState('networkidle')
  await clickAnd(page, btn(page, 'Re-check against the current board'))
  const c = await cs(sb, 4)
  expect(answer(c, 'release-notes|possible_existing_match')).toEqual({ choice: 'link', value: 'TASK-3' })
  expect(answer(c, 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-10-30' })
  expect(item(c, 'mobile-app-launch-sync').excluded).toBe(true)
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 4)).state).toBe('APPLIED')
})

test('an edit from another tab makes this tab\'s approval refuse instead of applying stale data, then it recovers', async ({ page, browser, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/approvals/4')
  await answerM4(page)
  const other = await browser.newPage()
  await signIn(other, sb, '/approvals/4')
  await exclude(other, 'login-screen', 'Finish the login screen')
  expect((await clickAnd(page, approveBtn(page))).status()).toBe(409)
  expect((await cs(sb, 4)).state).toBe('READY_FOR_REVIEW')
  await clickAnd(page, page.getByRole('status').getByRole('button', { name: 'Re-check against the current board' }))
  await expect(page.getByRole('status').filter({ hasText: 'What changed after your last action' })).toContainText('“Finish the login screen”: ready → excluded')
  await clickAnd(page, approveBtn(page))
  const c = await cs(sb, 4)
  expect(c.state).toBe('APPLIED')
  expect(Object.keys(c.applied_result.created ?? {})).not.toContain('login-screen')
  await other.close()
})

test('double-clicking Approve sends one approval; repeating it creates nothing new', async ({ page, watch }) => {
  await signIn(page, sb, '/approvals/4')
  await answerM4(page)
  const n0 = (await tasks(sb)).length
  await clickAnd(page, approveBtn(page), undefined, true)
  const c = await cs(sb, 4)
  expect(c.state).toBe('APPLIED')
  const n1 = (await tasks(sb)).length
  expect(n1 - n0).toBe(Object.keys(c.applied_result.created ?? {}).length)
  expect(watch.requests.filter(r => /^POST \/api\/changesets\/\d+\/approve$/.test(r)).length).toBe(1)
  const replay = await apiFor(sb).raw<{ result: { idempotent_replay?: boolean } }>('POST', `/api/changesets/${c.id}/approve`, { proposal_hash: c.proposal_hash })
  expect(replay.json.result.idempotent_replay).toBe(true)
  expect((await tasks(sb)).length).toBe(n1)
})

test('while an answer is being saved, other choices are disabled and only one request is sent', async ({ page, watch }) => {
  await signIn(page, sb, '/approvals/4')
  await page.route('**/api/changesets/*', async r => { if (r.request().method() === 'PATCH') await new Promise(x => setTimeout(x, 1500)); await r.continue() })
  const done = page.waitForResponse(r => r.request().method() === 'PATCH')
  await btn(page, 'Same as TASK-3').click()
  await expect(btn(page, 'It is a new task')).toBeDisabled()
  await expect(btn(page, 'Fri 30 Oct 2026')).toBeDisabled()
  await btn(page, 'Same as TASK-3').click({ force: true, timeout: 1000 }).catch(() => {})
  await done; await page.waitForLoadState('networkidle')
  expect(watch.requests.filter(r => r.startsWith('PATCH /api/changesets/')).length).toBe(1)
})

test('reject: Esc and "Keep reviewing" cancel; confirming rejects with the reason and makes the page read-only', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const dlg = page.getByRole('dialog', { name: 'Reject all proposed changes?' })
  await btn(page, 'Reject all').click(); await expect(dlg).toBeVisible()
  await page.keyboard.press('Escape'); await expect(dlg).toBeHidden()
  await btn(page, 'Reject all').click()
  await dlg.getByRole('button', { name: 'Keep reviewing' }).click(); await expect(dlg).toBeHidden()
  expect((await cs(sb, 4)).state).toBe('NEEDS_CLARIFICATION')
  await btn(page, 'Reject all').click()
  await dlg.getByLabel('Reason (optional)').fill('Audio quality too poor')
  await clickAnd(page, dlg.getByRole('button', { name: 'Reject all' }))
  expect((await cs(sb, 4)).state).toBe('REJECTED')
  await expect(main(page).getByText('These proposed changes were rejected.')).toBeVisible()
  await expect(approveBtn(page)).toHaveCount(0)
  await expect(btn(page, 'Same as TASK-3')).toHaveCount(0)
})

test('decisions: unticking is stored and the box reflects it straight away', async ({ page }) => {
  await signIn(page, sb, '/approvals/3')
  const id = (await cs(sb, 3)).proposal.decisions_review[0].id
  const box = main(page).getByRole('checkbox').first()
  await page.route('**/api/changesets/*', async r => { if (r.request().method() === 'PATCH') await new Promise(x => setTimeout(x, 800)); await r.continue() })
  const done = page.waitForResponse(r => r.request().method() === 'PATCH')
  await box.click()
  await expect(box).not.toBeChecked()
  await done; await page.waitForLoadState('networkidle')
  expect((await cs(sb, 3)).proposal.decisions_review.find(d => d.id === id)!.include).toBe(false)
  await expect(box).not.toBeChecked()
})

test('an applied approval is read-only and shows what each recorded revision changed', async ({ page }) => {
  await signIn(page, sb, '/approvals/2')
  await expect(main(page).getByText('Approved and applied')).toBeVisible()
  for (const name of ['Approve', 'Reject all', 'Change answer']) await expect(btn(page, name)).toHaveCount(0)
  await expect(row(page, 'TASK-2')).toContainText('TASK-2: reassign, move deadline')
  await expect(row(page, 'TASK-2')).toContainText(`Owner: Priya→${to}Samiksha`)
  await expect(row(page, 'rollback-runbook')).toContainText('Created TASK-4')
  const d = await openRow(page, 'TASK-2', 'Run regression tests')
  await expect(d.getByRole('heading', { name: 'What approval changed' })).toBeVisible()
  await expect(d.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await d.getByRole('button', { name: 'Close' }).click()
  await main(page).getByRole('button', { name: /^Show 2 items that will not change the board/ }).click()
  await expect(row(page, 'refund-api')).toBeVisible()
})

test('unrelated review actions never change approved tasks', async ({ page }) => {
  const before = JSON.stringify(await tasks(sb))
  await signIn(page, sb, '/approvals/4')
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await exclude(page, 'mobile-app-launch-sync', 'Sync on mobile app launch')
  await page.goto(sb.url + '/approvals/3'); await page.waitForLoadState('networkidle')
  await clickAnd(page, main(page).getByRole('checkbox').first())
  await btn(page, 'Reject all').click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Reject all' }))
  expect(JSON.stringify(await tasks(sb))).toBe(before)
})

test('phone: the change table, drawer and approval bar fit and work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, sb, '/approvals/4')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  const d = await openRow(page, 'login-screen', 'Finish the login screen')
  expect(await d.evaluate(e => e.getBoundingClientRect().width)).toBeLessThanOrEqual(390)
  await d.getByRole('button', { name: 'Close' }).click()
  await btn(page, 'Transcript').click()
  await expect(drawer(page, 'Transcript')).toBeVisible()
  await page.keyboard.press('Escape')
  await answerM4(page)
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 4)).state).toBe('APPLIED')
})
