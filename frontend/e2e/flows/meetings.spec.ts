// Overview queue, Meetings list, meeting workspace, upload form. Each test gets its own sandbox.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../demo')
const main = (page: Page) => page.getByRole('main')
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true })
const tab = (page: Page, name: RegExp | string) => main(page).getByRole('tab', { name })
const headerMore = (page: Page) => main(page).getByRole('button', { name: 'More' })

let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'meetings') })
test.afterEach(async () => { await sb.stop() })

type M = { id: number; processing_status: string; source_type: string | null }
// Expectations come from the sandbox's own API, so they hold whatever the copied demo data holds.
// "Meetings awaiting review" lists change sets waiting for approval plus meetings that failed or have no file.
const stuckCount = (ms: M[]) => ms.filter(m => m.processing_status === 'failed' || m.processing_status === 'created' || !m.source_type).length

test('Overview: every queue matches the API and each row opens the place to act', async ({ page }) => {
  await signIn(page, sb)
  const meetings = await apiFor(sb).get<M[]>('/api/meetings')
  const section = (name: string) => main(page).getByRole('region', { name: new RegExp(`^${name}`) })
  await expect(section('Meetings awaiting review').getByRole('listitem')).toHaveCount(2 + stuckCount(meetings))
  await expect(section('Upcoming tasks').getByRole('listitem')).toHaveCount(3)
  await expect(section('Upcoming tasks')).not.toContainText('Blocked')
  await expect(section('Recently processed meetings').getByRole('listitem')).toHaveCount(Math.min(5, meetings.length))
  await section('Meetings awaiting review').getByRole('link', { name: /Audio upload check/ }).click()
  await expect(page).toHaveURL(/\/approvals\/4$/)
  await page.goto(sb.url + '/')
  await section('Upcoming tasks').getByRole('link', { name: /TASK-4/ }).click()
  await expect(page).toHaveURL(/\/tasks\?task=TASK-4$/)
  await expect(page.getByRole('dialog', { name: 'Prepare the rollback runbook' })).toBeVisible()
  await page.goto(sb.url + '/')
  await section('Recently processed meetings').getByRole('link', { name: /Payments release planning/ }).click()
  await expect(page).toHaveURL(/\/meetings\/1$/)
  await page.goto(sb.url + '/')
  await main(page).getByRole('link', { name: 'Record or upload a meeting' }).click()
  await expect(h1(page, 'New meeting')).toBeVisible()
})

test('Overview: a blocked task says what it waits for, and a meeting needing a file shows up; both open', async ({ page }) => {
  await apiFor(sb).raw('POST', '/api/tasks/TASK-4/dependencies', { prerequisite_code: 'TASK-3' })
  await apiFor(sb).raw('POST', '/api/meetings', { title: 'Empty meeting', scheduled_at: '2026-10-23T10:00', timezone: 'Asia/Kolkata', consent_confirmed: true })
  await signIn(page, sb)
  const blocked = main(page).getByRole('region', { name: /^Upcoming tasks/ }).getByRole('listitem').filter({ hasText: 'TASK-4' })
  await expect(blocked).toContainText('waiting for TASK-3 Update the release notes')
  await expect(blocked).toContainText('Blocked')
  await blocked.getByRole('link').click()
  await expect(page.getByRole('dialog', { name: 'Prepare the rollback runbook' })).toBeVisible()
  await page.goto(sb.url + '/')
  const empty = main(page).getByRole('region', { name: /^Meetings awaiting review/ }).getByRole('link', { name: /Empty meeting/ })
  await expect(empty).toContainText('No recording or transcript uploaded yet.')
  await empty.click()
  await expect(h1(page, 'Empty meeting')).toBeVisible()
  await expect(main(page).getByText('Nothing uploaded yet')).toBeVisible()
})

test('Meetings: search and status filter narrow the list; a row opens the workspace', async ({ page }) => {
  const n = (await apiFor(sb).get<M[]>('/api/meetings')).length
  await signIn(page, sb, '/meetings')
  await expect(main(page).getByText(`${n} of ${n}`)).toBeVisible()
  await main(page).getByLabel('Search meetings').fill('payments')
  await expect(main(page).getByText(`3 of ${n}`)).toBeVisible()
  await main(page).getByLabel('Search meetings').fill('')
  await main(page).getByLabel('Status').selectOption('approved')
  await expect(main(page).getByText(`2 of ${n}`)).toBeVisible()
  await main(page).getByLabel('Status').selectOption('review')
  await expect(main(page).getByRole('row')).toHaveCount(3)
  await main(page).getByRole('row', { name: /Audio upload check/ }).click()
  await expect(h1(page, 'Audio upload check (synthetic TTS)')).toBeVisible()
})

test('results: evidence links open the transcript at the line, secondary tabs work by arrow keys, #segment links work', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  const transcript = page.getByRole('dialog', { name: 'Transcript' })
  await main(page).getByRole('button', { name: 'Show s7 in transcript' }).first().click()
  await expect(transcript.locator('[data-seg="s7"]')).toBeInViewport()
  await expect(transcript.locator('[data-seg="s7"]')).toHaveClass(/seg-flash/)
  await page.keyboard.press('Escape')
  await expect(transcript).toHaveCount(0)
  await expect(main(page).getByRole('cell', { name: /Run regression tests/ })).toBeVisible()
  await expect(main(page).getByRole('table').getByText('Updated TASK-2')).toBeVisible()
  await expect(tab(page, /^Speakers/)).toHaveAttribute('aria-selected', 'true')
  await tab(page, /^Speakers/).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tab(page, 'Share summary')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(tab(page, 'Technical details')).toHaveAttribute('aria-selected', 'true')
  await main(page).getByRole('button', { name: 'Show events' }).click()
  await main(page).getByRole('button', { name: 's6', exact: true }).first().click()
  await expect(transcript.locator('[data-seg="s6"]')).toHaveClass(/seg-flash/)
  await page.goto(sb.url + '/meetings/2#s5'); await page.waitForLoadState('networkidle')
  await expect(transcript.locator('[data-seg="s5"]')).toBeInViewport()
})

test('workspace: confirming a speaker is stored and acknowledged', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await tab(page, /^Speakers/).click()
  await main(page).getByLabel('Name for Asha').fill('Asha Rao')
  await clickAnd(page, main(page).getByRole('button', { name: 'Confirm' }).first())
  const m = await apiFor(sb).get<{ participants: { speaker_label: string; display_name: string; confirmed_identity: boolean }[] }>('/api/meetings/2')
  expect(m.participants.find(p => p.speaker_label === 'Asha')).toMatchObject({ display_name: 'Asha Rao', confirmed_identity: true })
  await expect(page.getByRole('status').filter({ hasText: 'Asha is now Asha Rao' })).toBeVisible()
  await expect(main(page).getByRole('listitem').filter({ hasText: 'Asha' }).getByText('Confirmed by you')).toBeVisible()
})

test('workspace: re-running an approved meeting is refused with the reason; the dialog can be cancelled', async ({ page, watch }) => {
  watch.allow(/process 409/)
  await signIn(page, sb, '/meetings/2')
  await headerMore(page).click()
  await page.getByRole('menuitem', { name: 'Re-run analysis' }).click()
  const d = page.getByRole('dialog', { name: 'Re-run the analysis?' })
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
  await headerMore(page).click()
  await page.getByRole('menuitem', { name: 'Re-run analysis' }).click()
  await clickAnd(page, d.getByRole('button', { name: 'Re-run analysis' }))
  await expect(page.getByRole('status').filter({ hasText: 're-running interpretation is disabled' })).toBeVisible()
})

test('workspace: delete is refused when approved tasks depend on it, and works for a meeting without approved work', async ({ page, watch }) => {
  watch.allow(/DELETE \/api\/meetings\/2 409/)
  await signIn(page, sb, '/meetings/2')
  await headerMore(page).click()
  await page.getByRole('menuitem', { name: 'Delete meeting' }).click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Delete meeting' }))
  await expect(page.getByRole('status').filter({ hasText: 'approved tasks reference this meeting' })).toBeVisible()
  expect((await apiFor(sb).raw('GET', '/api/meetings/2')).status).toBe(200)
  const m = await apiFor(sb).raw<{ id: number }>('POST', '/api/meetings', { title: 'Scratch meeting', scheduled_at: '2026-10-23T10:00', timezone: 'Asia/Kolkata', consent_confirmed: true })
  await page.goto(`${sb.url}/meetings/${m.json.id}`)
  await headerMore(page).click()
  await page.getByRole('menuitem', { name: 'Delete meeting' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click()
  expect((await apiFor(sb).raw('GET', `/api/meetings/${m.json.id}`)).status).toBe(200)
  await headerMore(page).click()
  await page.getByRole('menuitem', { name: 'Delete meeting' }).click()
  await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Delete meeting' }))
  await expect(h1(page, 'Meetings')).toBeVisible()
  expect((await apiFor(sb).raw('GET', `/api/meetings/${m.json.id}`)).status).toBe(404)
})

test('workspace: summary prepare, copy-approve (nothing sent), and email without SMTP is reported as NOT sent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, sb, '/meetings/2')
  await tab(page, 'Share summary').click()
  await clickAnd(page, main(page).getByRole('button', { name: 'Prepare summary' }))
  let s = await apiFor(sb).get<{ state: string; channel: string; content: string; error: string | null }[]>('/api/meetings/2/summaries')
  expect(s[0].state).toBe('prepared')
  await expect(main(page).getByText('Prepared, not approved')).toBeVisible()
  await clickAnd(page, main(page).getByRole('button', { name: 'Copy and mark approved' }))
  s = await apiFor(sb).get('/api/meetings/2/summaries')
  expect(s[0]).toMatchObject({ state: 'approved', channel: 'copy' })
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(s[0].content)
  await clickAnd(page, main(page).getByRole('button', { name: 'Prepare again' }))
  await main(page).getByLabel('Email recipients (comma-separated)').fill('team@example.com')
  await clickAnd(page, main(page).getByRole('button', { name: 'Approve and send' }))
  s = await apiFor(sb).get('/api/meetings/2/summaries')
  expect(s.length).toBe(2)
  expect(s[0]).toMatchObject({ state: 'approved', channel: 'email' })
  expect(s[0].error).toMatch(/NOT sent/)
  await expect(main(page).getByText('Approved for email, NOT sent')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'the email was NOT sent' })).toBeVisible()
  await expect(page.getByText('Email sent', { exact: true })).toHaveCount(0)
})

test('workspace: the recording plays from a clicked timestamp', async ({ page }) => {
  await signIn(page, sb, '/meetings/4')
  await main(page).getByRole('button', { name: 'Transcript', exact: true }).click()
  const audio = page.getByRole('dialog', { name: 'Transcript' }).locator('audio')
  await expect(audio).toHaveAttribute('src', /media\?sig=/)
  const loaded = await page.evaluate(() => new Promise<boolean>(r => {
    const a = document.querySelector('audio')!
    if (a.readyState >= 1) return r(true)
    a.addEventListener('loadedmetadata', () => r(true), { once: true }); a.addEventListener('error', () => r(false), { once: true }); setTimeout(() => r(false), 6000)
  }))
  test.skip(!loaded, 'BLOCKED: this headless Chromium build cannot decode the .m4a (AAC) recording')
  const seg = (await apiFor(sb).get<{ segments: { seg_key: string; start_seconds: number }[] }>('/api/meetings/4')).segments.find(x => x.seg_key === 's5')!
  await page.getByRole('button', { name: 'Play from 0:14' }).click()
  expect(Math.abs(await audio.evaluate((a: HTMLAudioElement) => a.currentTime) - seg.start_seconds)).toBeLessThan(0.6)
})

test('results: the primary action opens the approval; on a phone the transcript opens full width', async ({ page }) => {
  await signIn(page, sb, '/meetings/4')
  await main(page).getByRole('link', { name: 'Review and approve tasks' }).first().click()
  await expect(page).toHaveURL(/\/approvals\/4$/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(sb.url + '/meetings/4'); await page.waitForLoadState('networkidle')
  await main(page).getByRole('button', { name: 'Transcript', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s2"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})

test('upload form: disabled until title, file and consent; the file can be removed or dropped in', async ({ page }) => {
  await signIn(page, sb, '/meetings/new')
  await main(page).getByRole('radio', { name: /Upload transcript/ }).click()
  const up = main(page).getByRole('button', { name: 'Analyze meeting' })
  await expect(up).toBeDisabled()
  await main(page).getByLabel('Meeting title').fill('Audit upload')
  await main(page).getByLabel('Transcript file').setInputFiles(path.join(DEMO, 'synthetic_meeting_1_planning.json'))
  await expect(up).toBeDisabled()
  await main(page).getByLabel(/I confirm that every participant agreed/).check()
  await expect(up).toBeEnabled()
  await main(page).getByRole('button', { name: 'Remove file', exact: true }).click()
  await expect(up).toBeDisabled()
  const data = readFileSync(path.join(DEMO, 'synthetic_meeting_2_followup.json'), 'utf8')
  const dt = await page.evaluateHandle(d => { const t = new DataTransfer(); t.items.add(new File([d], 'followup.json', { type: 'application/json' })); return t }, data)
  await page.getByTestId('drop-zone').dispatchEvent('drop', { dataTransfer: dt })
  await expect(main(page).getByText('followup.json')).toBeVisible()
  await expect(up).toBeEnabled()
})

for (const [name, file, status, msg] of [
  ['an unsupported file type', { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }, 415, /unsupported|not supported|file type/i],
  ['a malformed transcript', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"segments": "nope"') }, 422, /transcript rejected/],
] as const) {
  test(`upload form: ${name} is refused with the reason and leaves no empty meeting behind`, async ({ page, watch }) => {
    watch.allow(new RegExp(`upload ${status}`))
    const before = (await apiFor(sb).get<unknown[]>('/api/meetings')).length
    await signIn(page, sb, '/meetings/new')
    await main(page).getByLabel('Meeting title').fill('Refused upload')
    const transcript = file.name.endsWith('.json')
    await main(page).getByRole('radio', { name: transcript ? /Upload transcript/ : /Upload recording/ }).click()
    await main(page).getByLabel(transcript ? 'Transcript file' : 'Recording file').setInputFiles(file)
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    await clickAnd(page, main(page).getByRole('button', { name: 'Analyze meeting' }), /^DELETE \/api\/meetings\/\d+$/)
    await expect(main(page).getByRole('alert')).toContainText(msg)
    await expect(main(page).getByRole('alert')).toContainText('Nothing was saved')
    expect((await apiFor(sb).get<unknown[]>('/api/meetings')).length).toBe(before)
    await expect(h1(page, 'New meeting')).toBeVisible()
  })
}

test('upload form: the title, date, time and time zone typed are what the server receives', async ({ page, watch }) => {
  watch.allow(/upload 422/)
  await signIn(page, sb, '/meetings/new')
  await main(page).getByLabel('Meeting title').fill('Time zone check')
  await main(page).getByLabel('Date and time').fill('2026-11-03T15:30')
  await main(page).getByText('More options').click() // the time zone is a secondary field
  await main(page).getByLabel('Meeting time zone').selectOption('Europe/London')
  await main(page).getByRole('radio', { name: /Upload transcript/ }).click()
  await main(page).getByLabel('Transcript file').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') })
  await main(page).getByLabel(/I confirm that every participant agreed/).check()
  const req = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/meetings')
  await main(page).getByRole('button', { name: 'Analyze meeting' }).click()
  expect((await req).postDataJSON()).toMatchObject({ title: 'Time zone check', scheduled_at: '2026-11-03T15:30', timezone: 'Europe/London', consent_confirmed: true })
  await expect(main(page).getByRole('alert')).toBeVisible()
})

test('workspace: after work starts from a one-off reload, the page keeps refreshing until it is done', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  await expect(main(page).getByText('Approved', { exact: true }).first()).toBeVisible()
  // The server reports work in progress (as right after "Re-run analysis")...
  await page.route('**/api/meetings/2', async r => {
    const res = await r.fetch(); const body = await res.json()
    await r.fulfill({ response: res, json: { ...body, processing_status: 'interpreting' } })
  })
  await main(page).getByRole('tab', { name: /^Speakers/ }).click()
  await main(page).getByLabel('Name for Asha').fill('Asha R')
  await clickAnd(page, main(page).getByRole('button', { name: 'Confirm' }).first()) // reloads once
  await expect(main(page).getByText('Processing: interpreting')).toBeVisible()
  // ...then finishes. Without a manual reload the page must notice.
  await page.unroute('**/api/meetings/2')
  await expect(main(page).getByText('Processing: interpreting')).toHaveCount(0, { timeout: 8000 })
  await expect(main(page).getByText('Approved', { exact: true }).first()).toBeVisible()
})
