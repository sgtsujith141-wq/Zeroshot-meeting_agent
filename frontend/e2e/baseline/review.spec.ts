// BASELINE AUDIT (UI at 10deb16): review screen. Every mutation is checked against the API.
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

type Item = { key: string; title: string; owner: string | null; owner_status: string; excluded?: boolean; depends_on: { key: string }[]; history: { summary: string }[]; deadline: { date: string | null } }
type CS = { id: number; state: string; version: number; proposal_hash: string; ledger_snapshot: { code: string; revision: number }[]
  proposal: { items: Item[]; clarifications: { kind: string; item_keys: string[]; answer: { choice: string; value: string | null } | null }[]; decisions_review: { id: number; include: boolean }[] }
  applied_result: { created?: Record<string, string>; updated?: string[]; completed?: string[] } }
type T = { code: string; title: string; owner: string | null; due_date: string | null; status: string; revision: number; priority: string | null; prerequisites: { code: string }[] }

const cs = (sb: Sandbox, m: number) => apiFor(sb).get<CS>(`/api/meetings/${m}/changeset`)
const answer = (c: CS, key: string) => c.proposal.clarifications.find(q => q.item_keys[0] + '|' + q.kind === key)?.answer ?? null
const item = (c: CS, key: string) => c.proposal.items.find(i => i.key === key)!
const tasks = (sb: Sandbox) => apiFor(sb).get<T[]>('/api/tasks')
const card = (page: Page, title: string) => page.locator('article').filter({ has: page.getByRole('heading', { name: title }) })
const qcard = (page: Page, text: string) => page.locator('li').filter({ hasText: text }).filter({ has: page.getByRole('button') })
const approveBtn = (page: Page) => page.getByRole('button', { name: /^Approve \d+ change/ })
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const nthCard = async (page: Page, title: string) =>
  page.locator('article').nth(await page.locator('article').evaluateAll((els, t) => els.findIndex(e => e.querySelector('h3')?.textContent?.includes(t)), title))

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'base-review') })
test.afterEach(async () => { await sb.stop() })

async function answerM4(page: Page) {
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await clickAnd(page, btn(page, 'Fri, Oct 30, 2026'))
  await clickAnd(page, card(page, 'Sync on mobile app launch').getByRole('button', { name: 'Exclude' }))
  await expect(approveBtn(page)).toBeEnabled()
}

test('V01 approval is disabled while questions are open and the bar says why', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await expect(approveBtn(page)).toBeDisabled()
  await expect(page.getByText(/Answer 4 open questions/)).toBeVisible()
})

test('V02 Map speaker stores the identity and removes the question', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await page.getByPlaceholder('Who is SPEAKER_00?').fill('Kavya')
  await clickAnd(page, btn(page, 'Map speaker'))
  const m = await apiFor(sb).get<{ participants: { speaker_label: string; display_name: string | null; confirmed_identity: boolean }[] }>('/api/meetings/4')
  expect(m.participants[0]).toMatchObject({ speaker_label: 'SPEAKER_00', display_name: 'Kavya', confirmed_identity: true })
  await expect(page.getByPlaceholder('Who is SPEAKER_00?')).toHaveCount(0)
  await expect(page.getByText(/SPEAKER_00 mapped to Kavya/)).toBeVisible()
})

test('V03+V04 "Same as TASK-3" stores the link; "Change answer" removes it', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  expect(answer(await cs(sb, 4), 'release-notes|possible_existing_match')).toEqual({ choice: 'link', value: 'TASK-3' })
  await expect(btn(page, 'Same as TASK-3')).toHaveCount(0)
  await clickAnd(page, btn(page, 'Change answer').first())
  expect(answer(await cs(sb, 4), 'release-notes|possible_existing_match')).toBeNull()
  await expect(btn(page, 'Same as TASK-3')).toBeVisible()
})

test('V05+V06 deadline answers: candidate, custom date, no deadline', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'Fri, Oct 30, 2026'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-10-30' })
  await clickAnd(page, btn(page, 'Change answer').first())
  await page.getByLabel('Due date', { exact: true }).fill('2026-11-02')
  await clickAnd(page, btn(page, 'Use this date'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-11-02' })
  await clickAnd(page, btn(page, 'Change answer').first())
  await clickAnd(page, btn(page, 'No deadline'))
  expect(answer(await cs(sb, 4), 'login-screen|ambiguous_deadline')?.choice).toBe('no_deadline')
})

test('V07 owner answers: Set owner, then Leave unassigned', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  const q = qcard(page, 'Who owns “Sync on mobile app launch”?')
  await q.getByLabel('Owner', { exact: true }).fill('Asha')
  await clickAnd(page, q.getByRole('button', { name: 'Set owner' }))
  expect(answer(await cs(sb, 4), 'mobile-app-launch-sync|missing_owner')).toEqual({ choice: 'set_owner', value: 'Asha' })
  expect(item(await cs(sb, 4), 'mobile-app-launch-sync').owner).toBe('Asha')
  await clickAnd(page, btn(page, 'Change answer').last())
  await clickAnd(page, qcard(page, 'Who owns “Sync on mobile app launch”?').getByRole('button', { name: 'Leave unassigned' }))
  expect(answer(await cs(sb, 4), 'mobile-app-launch-sync|missing_owner')?.choice).toBe('unassigned')
})

test('V08 Exclude hides the item\'s question; Include again restores both', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, card(page, 'Sync on mobile app launch').getByRole('button', { name: 'Exclude' }))
  expect(item(await cs(sb, 4), 'mobile-app-launch-sync').excluded).toBe(true)
  await expect(page.getByText('Who owns “Sync on mobile app launch”?')).toHaveCount(0)
  await clickAnd(page, card(page, 'Sync on mobile app launch').getByRole('button', { name: 'Include again' }))
  expect(item(await cs(sb, 4), 'mobile-app-launch-sync').excluded).toBe(false)
  await expect(page.getByText('Who owns “Sync on mobile app launch”?')).toBeVisible()
})

test('V09 Edit saves organiser edits; Cancel discards them', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  let c = await nthCard(page, 'Start the release notes')
  await c.getByRole('button', { name: 'Edit' }).click()
  await c.getByLabel('Owner', { exact: true }).fill('Priya')
  await c.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForLoadState('networkidle')
  expect(item(await cs(sb, 4), 'release-notes').owner).toBe('Meera')
  c = await nthCard(page, 'Start the release notes')
  await c.getByRole('button', { name: 'Edit' }).click()
  await c.getByLabel('Owner', { exact: true }).fill('Priya')
  await clickAnd(page, c.getByRole('button', { name: 'Save edits' }))
  expect(item(await cs(sb, 4), 'release-notes').owner).toBe('Priya')
})

test('V10 removing a proposed dependency is stored', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'Remove dependency on Payment API is done and merged'))
  expect(item(await cs(sb, 4), 'release-notes').depends_on).toEqual([])
})

test('V11+V12+V13 evidence chips focus the transcript; hover highlights; steps open', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await page.getByRole('button', { name: 'Show segment s3 in transcript' }).first().click()
  const line = page.locator('[data-seg="s3"]')
  await expect(line).toBeInViewport()
  await expect(line).toHaveClass(/seg-flash/)
  await card(page, 'Finish the login screen').hover()
  await expect(page.locator('[data-seg="s2"]')).toHaveClass(/bg-sky-soft/)
  await card(page, 'Finish the login screen').getByText(/How this was worked out/).click()
  await expect(card(page, 'Finish the login screen').locator('ol li').first()).toBeVisible()
})

test('V14 Reject dialog: Esc and Keep reviewing cancel; Reject all rejects with the reason', async ({ page }) => {
  await signIn(page, sb, '/review/4')
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
  await expect(page.getByText('These proposed changes were rejected')).toBeVisible()
  await expect(approveBtn(page)).toHaveCount(0)
})

test('V15+V16 approval applies exactly what was shown and the page stays rendered', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  const before = await tasks(sb)
  await expect(card(page, 'Finish the login screen')).toContainText('Kavya')
  await expect(card(page, 'Finish the login screen')).toContainText('Fri, Oct 30, 2026')
  const r = await clickAnd(page, approveBtn(page))
  expect(r.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Approved and applied' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await cs(sb, 4)).state).toBe('APPLIED')
  const after = await tasks(sb)
  const created = after.filter(t => !before.some(b => b.code === t.code))
  expect(created.map(t => t.title)).toEqual(['Finish the login screen'])
  expect(created[0]).toMatchObject({ owner: 'Kavya', due_date: '2026-10-30' })
  const t3 = after.find(t => t.code === 'TASK-3')!
  expect(t3).toMatchObject({ owner: 'Meera', title: 'Update the release notes', revision: before.find(t => t.code === 'TASK-3')!.revision + 1 })
})

test('V17 double-clicking approve and repeating the approval never duplicate tasks', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  const before = (await tasks(sb)).length
  await clickAnd(page, approveBtn(page), undefined, true)
  await page.waitForTimeout(500)
  const c1 = await cs(sb, 4)
  expect(c1.state).toBe('APPLIED')
  const after = (await tasks(sb)).length
  expect(after - before).toBe(Object.keys(c1.applied_result.created ?? {}).length)
  const replay = await apiFor(sb).raw<{ result: { idempotent_replay?: boolean } }>('POST', `/api/changesets/${c1.id}/approve`, { proposal_hash: c1.proposal_hash })
  expect(replay.status).toBe(200)
  expect(replay.json.result.idempotent_replay).toBe(true)
  expect((await tasks(sb)).length).toBe(after)
  expect(watch.requests.filter(r => r.startsWith('POST /api/changesets/') && r.endsWith('/approve')).length).toBe(1)
})

test('V18 approving meeting 4 then meeting 3 shows a recoverable stale-board state', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  await clickAnd(page, approveBtn(page))
  await page.goto(sb.url + '/review/3'); await page.waitForLoadState('networkidle')
  await expect(page.getByText('The task board changed after this proposal was checked')).toBeVisible()
  await expect(approveBtn(page)).toBeDisabled()
  await clickAnd(page, btn(page, 'Re-check against the current board'))
  const live = (await tasks(sb)).filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).map(t => `${t.code}@${t.revision}`).sort()
  expect((await cs(sb, 3)).ledger_snapshot.map(t => `${t.code}@${t.revision}`).sort()).toEqual(live)
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 3)).state).toBe('APPLIED')
})

test('V19 meeting 3 then meeting 4: re-check keeps the answers already given', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  await page.goto(sb.url + '/review/3'); await page.waitForLoadState('networkidle')
  const first = await clickAnd(page, approveBtn(page))
  if (first.status() === 409) {
    await clickAnd(page, btn(page, 'Re-check against the current board'))
    await clickAnd(page, approveBtn(page))
  }
  expect((await cs(sb, 3)).state).toBe('APPLIED')
  await page.goto(sb.url + '/review/4'); await page.waitForLoadState('networkidle')
  await clickAnd(page, btn(page, 'Re-check against the current board'))
  const c = await cs(sb, 4)
  expect(answer(c, 'release-notes|possible_existing_match')).toEqual({ choice: 'link', value: 'TASK-3' })
  expect(answer(c, 'login-screen|ambiguous_deadline')).toEqual({ choice: 'set_due', value: '2026-10-30' })
  expect(item(c, 'mobile-app-launch-sync').excluded).toBe(true)
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 4)).state).toBe('APPLIED')
})

test('V20 an edit from another tab makes this tab\'s approval refuse, then recover', async ({ page, browser, watch }) => {
  watch.allow(/approve 409/)
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  const other = await browser.newPage()
  await signIn(other, sb, '/review/4')
  await clickAnd(other, card(other, 'Finish the login screen').getByRole('button', { name: 'Exclude' }))
  const r = await clickAnd(page, approveBtn(page))
  expect(r.status()).toBe(409)
  expect((await cs(sb, 4)).state).toBe('READY_FOR_REVIEW')
  await expect(page.getByText(/changed since it was reviewed/).first()).toBeVisible()
  await clickAnd(page, btn(page, 'Re-check against the current board'))
  await expect(card(page, 'Finish the login screen')).toContainText('Excluded by you')
  await clickAnd(page, approveBtn(page))
  const c = await cs(sb, 4)
  expect(c.state).toBe('APPLIED')
  expect(Object.keys(c.applied_result.created ?? {})).not.toContain('login-screen')
  await other.close()
})

test('V21 a slow answer disables the other choices and sends one request', async ({ page, watch }) => {
  await signIn(page, sb, '/review/4')
  await page.route('**/api/changesets/*', async r => { if (r.request().method() === 'PATCH') await new Promise(x => setTimeout(x, 1500)); await r.continue() })
  const done = page.waitForResponse(r => r.request().method() === 'PATCH')
  await btn(page, 'Same as TASK-3').click()
  await expect(btn(page, 'It is a new task')).toBeDisabled()
  await btn(page, 'Same as TASK-3').click({ force: true, timeout: 1000 }).catch(() => {})
  await done; await page.waitForLoadState('networkidle')
  expect(watch.requests.filter(r => r.startsWith('PATCH /api/changesets/')).length).toBe(1)
})

test('V22 unticking a decision is stored', async ({ page }) => {
  await signIn(page, sb, '/review/3')
  const id = (await cs(sb, 3)).proposal.decisions_review[0].id
  await clickAnd(page, page.getByRole('checkbox').first())
  expect((await cs(sb, 3)).proposal.decisions_review.find(d => d.id === id)!.include).toBe(false)
  await expect(page.getByRole('checkbox').first()).not.toBeChecked()
})

test('V23+V25 an applied review is read-only and its unchanged rows expand', async ({ page }) => {
  await signIn(page, sb, '/review/2')
  await expect(page.getByRole('heading', { name: 'Approved and applied' })).toBeVisible()
  for (const name of ['Edit', 'Exclude', 'Reject all']) await expect(btn(page, name)).toHaveCount(0)
  await expect(approveBtn(page)).toHaveCount(0)
  await page.getByRole('button', { name: /TASK-1 Finish the refund API/ }).click()
  await expect(page.getByRole('button', { name: /TASK-1 Finish the refund API/ })).toHaveAttribute('aria-expanded', 'true')
})

test('V24 laptop width: the Transcript button opens a drawer that Esc closes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await signIn(page, sb, '/review/4')
  await btn(page, 'Transcript').click()
  const d = page.getByRole('dialog', { name: 'Source transcript' })
  await expect(d).toBeVisible()
  await page.keyboard.press('Escape'); await expect(d).toBeHidden()
})

test('V26a SPEAKER_00: an unrelated answer never maps the anonymous speaker; owners stay attributable', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  const v1 = await cs(sb, 4)
  expect(item(v1, 'login-screen').owner).toBeNull()
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  const m = await apiFor(sb).get<{ participants: { display_name: string | null }[]; segments: { seg_key: string; text: string }[] }>('/api/meetings/4')
  expect(m.participants.every(p => p.display_name === null)).toBe(true)
  const v2 = await cs(sb, 4)
  expect(v2.version).toBeGreaterThan(v1.version)
  // Any owner must come from a name spoken in the transcript, never from the unmapped label.
  for (const it of v2.proposal.items.filter(i => i.owner)) {
    expect(['named', 'confirmed', 'accepted_per_organiser']).toContain(it.owner_status)
    expect(m.segments.some(s => s.text.includes(it.owner!))).toBe(true)
  }
  const login = item(v2, 'login-screen')
  expect(login.owner).toBe('Kavya')
  expect(login.history.map(h => h.summary).join(' | ')).toMatch(/kept named owner Kavya/)
})

test('V26b SPEAKER_00: the review tells the organiser when an answer changed other items', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await expect(page.getByText(/changed (after|since)|updated after your answer/i).first()).toBeVisible({ timeout: 3000 })
})

test('V28 unrelated review interactions never alter approved tasks', async ({ page }) => {
  const before = JSON.stringify(await tasks(sb))
  await signIn(page, sb, '/review/4')
  await clickAnd(page, btn(page, 'Same as TASK-3'))
  await clickAnd(page, card(page, 'Sync on mobile app launch').getByRole('button', { name: 'Exclude' }))
  await page.goto(sb.url + '/review/3'); await page.waitForLoadState('networkidle')
  await clickAnd(page, page.getByRole('checkbox').first())
  await btn(page, 'Reject all').click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Reject all' }))
  expect(JSON.stringify(await tasks(sb))).toBe(before)
})

test('V29 renaming an existing task in the review is shown only if approval applies it', async ({ page }) => {
  await signIn(page, sb, '/review/4')
  await answerM4(page)
  const c = await nthCard(page, 'Update the release notes')
  await c.getByRole('button', { name: 'Edit' }).click()
  await c.getByLabel('Title').fill('Write the release notes')
  await clickAnd(page, c.getByRole('button', { name: 'Save edits' }))
  const shownRename = await page.getByText('Write the release notes').count() > 0
  await clickAnd(page, approveBtn(page))
  const t3 = (await tasks(sb)).find(t => t.code === 'TASK-3')!
  expect({ shownRename, applied: t3.title === 'Write the release notes' }).toEqual({ shownRename, applied: shownRename })
})

test('V30 after a re-check, the flagged changes to TASK-2 are exactly what approval applies', async ({ page }) => {
  await apiFor(sb).raw('POST', '/api/meetings/3/changeset/recompute')
  const before = (await tasks(sb)).find(t => t.code === 'TASK-2')!
  await signIn(page, sb, '/review/3')
  const c = card(page, 'Run regression tests')
  await expect(c).toBeVisible()
  const shown = {
    due: await c.getByText('Deadline moved').count() > 0,
    deps: await c.getByText('Dependency changed').count() > 0,
    priority: await c.locator('.line-through').filter({ hasText: /high|medium|low|not stated/i }).count() > 0,
  }
  await clickAnd(page, approveBtn(page))
  expect((await cs(sb, 3)).state).toBe('APPLIED')
  const after = (await tasks(sb)).find(t => t.code === 'TASK-2')!
  const applied = {
    due: after.due_date !== before.due_date,
    deps: after.prerequisites.map(p => p.code).join() !== before.prerequisites.map(p => p.code).join(),
    priority: after.priority !== before.priority,
  }
  expect(shown).toEqual(applied)
})
