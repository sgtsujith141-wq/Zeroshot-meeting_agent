// BASELINE AUDIT (UI at 10deb16): meeting page, new meeting form, task board.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../demo')
type T = { code: string; title: string; owner: string | null; status: string; revision: number; prerequisites: { code: string }[] }
const settle = (page: Page) => page.waitForLoadState('networkidle')

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'base-mt') })
test.afterEach(async () => { await sb.stop() })

test('M01 confirming a speaker name is stored and acknowledged', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await page.getByLabel('Name for Asha').fill('Asha Rao')
  await clickAnd(page, page.getByRole('button', { name: 'Confirm' }).first())
  const m = await apiFor(sb).get<{ participants: { speaker_label: string; display_name: string; confirmed_identity: boolean }[] }>('/api/meetings/2')
  expect(m.participants.find(p => p.speaker_label === 'Asha')).toMatchObject({ display_name: 'Asha Rao', confirmed_identity: true })
  await expect(page.getByText(/Asha is now Asha Rao/)).toBeVisible()
})

test('M02+M03 minutes and decision evidence focus the transcript line', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await page.getByRole('button', { name: 's7', exact: true }).first().click()
  await expect(page.locator('[data-seg="s7"]')).toBeInViewport()
  await expect(page.locator('[data-seg="s7"]')).toHaveClass(/seg-flash/)
  await page.getByRole('button', { name: /Samiksha, 0:18/ }).first().click()
  await expect(page.locator('[data-seg="s4"]')).toHaveClass(/seg-flash/)
})

test('M04 re-running analysis of an approved meeting is refused with the reason', async ({ page, watch }) => {
  watch.allow(/process 409/)
  await signIn(page, sb, '/meetings/2')
  await clickAnd(page, page.getByRole('button', { name: 'Re-run analysis' }))
  await expect(page.getByText(/already approved; re-running interpretation is disabled/)).toBeVisible()
})

test('M05 deleting a meeting that created approved tasks is refused; nothing is removed', async ({ page, watch }) => {
  watch.allow(/DELETE \/api\/meetings\/2 409/)
  await signIn(page, sb, '/meetings/2')
  await page.getByRole('button', { name: 'Delete' }).click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Delete meeting' }))
  await expect(page.getByText(/approved tasks reference this meeting/)).toBeVisible()
  expect((await apiFor(sb).raw('GET', '/api/meetings/2')).status).toBe(200)
})

test('M06 deleting a meeting without approved work removes it and returns to Overview', async ({ page }) => {
  const m = await apiFor(sb).raw<{ id: number }>('POST', '/api/meetings', { title: 'Scratch meeting', scheduled_at: '2026-10-23T10:00', timezone: 'Asia/Kolkata', consent_confirmed: true })
  await signIn(page, sb, `/meetings/${m.json.id}`)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click()
  expect((await apiFor(sb).raw('GET', `/api/meetings/${m.json.id}`)).status).toBe(200)
  await page.getByRole('button', { name: 'Delete' }).click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Delete meeting' }))
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  expect((await apiFor(sb).raw('GET', `/api/meetings/${m.json.id}`)).status).toBe(404)
})

test('M07+M08 prepare a summary, then copy and mark it approved (nothing sent)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, sb, '/meetings/2')
  await clickAnd(page, page.getByRole('button', { name: 'Prepare summary' }))
  let s = await apiFor(sb).get<{ state: string; channel: string; content: string }[]>('/api/meetings/2/summaries')
  expect(s[0].state).toBe('prepared')
  await clickAnd(page, page.getByRole('button', { name: 'Copy and mark approved' }))
  s = await apiFor(sb).get('/api/meetings/2/summaries')
  expect(s[0]).toMatchObject({ state: 'approved', channel: 'copy' })
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(s[0].content)
})

test('M09 "Approve and send" without SMTP never claims the email was sent', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await clickAnd(page, page.getByRole('button', { name: 'Prepare summary' }))
  await page.getByLabel('Email recipients (comma-separated)').fill('team@example.com')
  await clickAnd(page, page.getByRole('button', { name: 'Approve and send' }))
  const s = await apiFor(sb).get<{ state: string; error: string | null }[]>('/api/meetings/2/summaries')
  expect(s[0].state).toBe('approved')
  expect(s[0].error).toMatch(/NOT sent/)
  await expect(page.getByText(/NOT sent/).first()).toBeVisible()
  await expect(page.getByText('Sent', { exact: true })).toHaveCount(0)
})

test('M10+M11 events toggle; "Review changes" opens the review', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await page.getByRole('button', { name: /^Show \d+ events/ }).click()
  await expect(page.getByRole('button', { name: 'Hide events' })).toBeVisible()
  await page.getByRole('link', { name: 'Review changes' }).last().click()
  await expect(page).toHaveURL(/\/review\/2$/)
})

test('M12 a #segment link focuses that line', async ({ page }) => {
  await signIn(page, sb)
  await page.goto(sb.url + '/meetings/2#s5'); await settle(page)
  await expect(page.locator('[data-seg="s5"]')).toBeInViewport()
})

test('M13 a transcript timestamp seeks the recording', async ({ page }) => {
  await signIn(page, sb, '/meetings/4')
  const audio = page.locator('audio')
  await expect(audio).toHaveAttribute('src', /media\?sig=/)
  const loaded = await page.evaluate(() => new Promise<boolean>(r => {
    const a = document.querySelector('audio')!
    if (a.readyState >= 1) return r(true)
    a.addEventListener('loadedmetadata', () => r(true), { once: true }); a.addEventListener('error', () => r(false), { once: true }); setTimeout(() => r(false), 6000)
  }))
  test.skip(!loaded, 'BLOCKED: this headless Chromium build cannot decode the .m4a (AAC) recording')
  const seg = (await apiFor(sb).get<{ segments: { seg_key: string; start_seconds: number }[] }>('/api/meetings/4')).segments.find(x => x.seg_key === 's5')!
  await page.getByRole('button', { name: '0:14' }).click()
  expect(Math.abs(await audio.evaluate((a: HTMLAudioElement) => a.currentTime) - seg.start_seconds)).toBeLessThan(0.6)
})

test('N01+N02 upload stays disabled until title, file and consent; the file can be removed', async ({ page }) => {
  await signIn(page, sb, '/meetings/new')
  const btn = page.getByRole('button', { name: 'Upload and process' })
  await expect(btn).toBeDisabled()
  await page.getByLabel('Meeting title').fill('Audit upload')
  await page.getByLabel('Recording or transcript').setInputFiles(path.join(DEMO, 'synthetic_meeting_1_planning.json'))
  await expect(btn).toBeDisabled()
  await page.getByLabel(/I confirm that every participant agreed/).check()
  await expect(btn).toBeEnabled()
  await page.getByRole('button', { name: 'Remove file', exact: true }).click()
  await expect(btn).toBeDisabled()
})

test('N03 an unsupported file type is refused and leaves no empty meeting behind', async ({ page, watch }) => {
  watch.allow(/upload 415/)
  const before = (await apiFor(sb).get<unknown[]>('/api/meetings')).length
  await signIn(page, sb, '/meetings/new')
  await page.getByLabel('Meeting title').fill('Bad file')
  await page.getByLabel('Recording or transcript').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await page.getByLabel(/I confirm that every participant agreed/).check()
  await clickAnd(page, page.getByRole('button', { name: 'Upload and process' }))
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await apiFor(sb).get<unknown[]>('/api/meetings')).length).toBe(before)
})

test('N04 a malformed transcript is refused with the reason and leaves no empty meeting', async ({ page, watch }) => {
  watch.allow(/upload 422/)
  const before = (await apiFor(sb).get<unknown[]>('/api/meetings')).length
  await signIn(page, sb, '/meetings/new')
  await page.getByLabel('Meeting title').fill('Broken transcript')
  await page.getByLabel('Recording or transcript').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"segments": "nope"') })
  await page.getByLabel(/I confirm that every participant agreed/).check()
  await clickAnd(page, page.getByRole('button', { name: 'Upload and process' }))
  await expect(page.getByRole('alert')).toContainText(/transcript rejected/)
  expect((await apiFor(sb).get<unknown[]>('/api/meetings')).length).toBe(before)
})

test('N06 dropping a file onto the drop zone selects it', async ({ page }) => {
  await signIn(page, sb, '/meetings/new')
  const data = readFileSync(path.join(DEMO, 'synthetic_meeting_2_followup.json'), 'utf8')
  const dt = await page.evaluateHandle(d => { const t = new DataTransfer(); t.items.add(new File([d], 'followup.json', { type: 'application/json' })); return t }, data)
  await page.locator('label[for="meeting-file"]').last().dispatchEvent('drop', { dataTransfer: dt })
  await expect(page.getByText('followup.json')).toBeVisible()
})

test('T01+T02 search and owner filter narrow the board; Clear resets', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByLabel('Filter tasks').fill('runbook')
  await expect(page.getByText('1 of 4 tasks')).toBeVisible()
  await page.getByLabel('Filter tasks').fill('')
  await page.getByLabel('Owner').selectOption('Rahul')
  await expect(page.getByText('2 of 4 tasks')).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('4 of 4 tasks')).toBeVisible()
})

test('T03 a task opens a drawer; Close and Esc both close it', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-3\b/ }).click()
  await expect(page.getByRole('heading', { name: 'Where this came from' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^TASK-3\b/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('T04 moving a task is stored with a new revision', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-3\b/ }).click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'In progress' }))
  const t = (await apiFor(sb).get<T[]>('/api/tasks')).find(x => x.code === 'TASK-3')!
  expect(t).toMatchObject({ status: 'in_progress', revision: 2 })
  await expect(page.getByText('TASK-3 moved to In progress')).toBeVisible()
})

test('T05 a stale task revision is refused and the drawer shows the current state', async ({ page, watch }) => {
  watch.allow(/PATCH \/api\/tasks\/TASK-3 409/)
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-3\b/ }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'In progress' })).toBeVisible()
  await apiFor(sb).raw('PATCH', '/api/tasks/TASK-3', { expected_revision: 1, status: 'blocked', blocked_reason: 'changed elsewhere' })
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'In progress' }))
  await expect(page.getByText(/is at revision 2, not 1/)).toBeVisible()
  expect((await apiFor(sb).get<T[]>('/api/tasks')).find(x => x.code === 'TASK-3')!.status).toBe('blocked')
  await expect(page.getByRole('dialog').getByText('TASK-3, revision 2')).toBeVisible()
})

test('T06 an unfinished prerequisite disables start/finish and the server refuses too', async ({ page, watch }) => {
  watch.allow(/PATCH \/api\/tasks\/TASK-4 409/)
  await apiFor(sb).raw('POST', '/api/tasks/TASK-4/dependencies', { prerequisite_code: 'TASK-3' })
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-4\b/ }).click()
  const d = page.getByRole('dialog')
  await expect(d.getByRole('button', { name: 'In progress' })).toBeDisabled()
  await expect(d.getByRole('button', { name: 'Done' })).toBeDisabled()
  await expect(d.getByText(/disabled until TASK-3 is done/)).toBeVisible()
  const r = await apiFor(sb).raw('PATCH', '/api/tasks/TASK-4', { expected_revision: 1, status: 'done' })
  expect(r.status).toBe(409)
})

test('T07+T08+T09 .ics export, evidence link and origin link', async ({ page }) => {
  await signIn(page, sb, '/tasks')
  await page.getByRole('button', { name: /^TASK-2\b/ }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: '.ics' }).click()
  const file = await (await dl).path()
  const ics = readFileSync(file!, 'utf8')
  expect(ics).toContain('BEGIN:VCALENDAR'); expect(ics).toContain('TASK-2')
  await page.getByRole('dialog').getByRole('link', { name: /Payments release follow-up \(synthetic\), Samiksha/ }).click()
  await expect(page).toHaveURL(/\/meetings\/2#s4$/)
  await expect(page.locator('[data-seg="s4"]')).toBeInViewport()
})

test('T10 a reassignment keeps the same task identity with a revision history', async () => {
  const t = await apiFor(sb).get<{ id: number; code: string; owner: string; revisions: { revision: number; snapshot: { owner: string } }[] }>('/api/tasks/TASK-2')
  expect(t.code).toBe('TASK-2')
  expect(t.revisions.map(r => [r.revision, r.snapshot.owner])).toEqual([[1, 'Priya'], [2, 'Samiksha']])
  expect((await apiFor(sb).get<T[]>('/api/tasks')).filter(x => x.title === 'Run regression tests')).toHaveLength(1)
})
