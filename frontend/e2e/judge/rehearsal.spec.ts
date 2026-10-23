// Round 2 judge rehearsal, scenarios C–G: a sceptical judge working through the demo data in a
// fresh browser session. Each scenario checks the screen and the server's records. Disposable
// sandboxes copy the demo workspace; no model is called here (see live.spec.ts for that).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'
import type { MeetingDetail } from '../../src/types'

const main = (page: Page) => page.getByRole('main')
let sb: Sandbox
test.beforeEach(async () => { sb = await startSandbox('demo', 'judge') })
test.afterEach(async () => { await sb.stop() })

test('C: reassignment — Priya in meeting 1, Samiksha in meeting 2, one task, history kept', async ({ page }) => {
  await signIn(page, sb, '/meetings/1')
  const m1 = main(page).getByRole('table').getByRole('row', { name: /Run regression tests/ })
  await expect(m1).toContainText('Priya')
  await page.goto(sb.url + '/approvals/2'); await page.waitForLoadState('networkidle')
  const row = page.locator('tr[data-item="TASK-2"]')
  await expect(row).toContainText('TASK-2: reassign, move deadline')
  await expect(row).toContainText('Owner: Priya→ changes to Samiksha')
  await expect(row).toContainText('Updated TASK-2')
  const tasks = await apiFor(sb).get<{ code: string; title: string }[]>('/api/tasks')
  expect(tasks.filter(t => /regression/i.test(t.title)).map(t => t.code)).toEqual(['TASK-2']) // one persistent task
  await page.goto(sb.url + '/tasks?task=TASK-2'); await page.waitForLoadState('networkidle')
  const drawer = page.getByRole('dialog', { name: 'Run regression tests' })
  await expect(drawer).toContainText('Revision 1')
  await expect(drawer).toContainText('Revision 2')
  await expect(drawer).toContainText('Owner Priya')
  await expect(drawer).toContainText('Owner Samiksha')
})

test('D: approval safety — open questions, stale board, duplicate approval, no token', async ({ page, watch }) => {
  watch.allow(/approve 409/)
  const api = apiFor(sb)
  // Open questions: the button is disabled, and the server refuses a forced request too.
  await signIn(page, sb, '/approvals/4')
  await expect(main(page).getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  const cs4 = await api.get<{ id: number; proposal_hash: string }>('/api/meetings/4/changeset')
  expect((await api.raw('POST', `/api/changesets/${cs4.id}/approve`, { proposal_hash: cs4.proposal_hash })).status).toBe(409)
  // A stale proposal (meeting 3 predates the board) is refused, then re-checked and approved once.
  await page.goto(sb.url + '/approvals/3'); await page.waitForLoadState('networkidle')
  const first = await clickAnd(page, main(page).getByRole('button', { name: 'Approve', exact: true }))
  expect(first.status()).toBe(409)
  await clickAnd(page, page.getByRole('status').getByRole('button', { name: 'Re-check against the current board' }))
  const before = (await api.get<unknown[]>('/api/tasks')).length
  await clickAnd(page, main(page).getByRole('button', { name: 'Approve', exact: true }))
  const cs3 = await api.get<{ id: number; state: string; proposal_hash: string }>('/api/meetings/3/changeset')
  expect(cs3.state).toBe('APPLIED')
  const again = await api.raw<{ result?: { idempotent_replay?: boolean } }>('POST', `/api/changesets/${cs3.id}/approve`, { proposal_hash: cs3.proposal_hash })
  expect(again.status).toBe(200)
  expect(again.json.result?.idempotent_replay).toBe(true)
  expect((await api.get<unknown[]>('/api/tasks')).length).toBe(before + 1) // the new task once, not twice
  // Without the organiser token nothing can be read or changed.
  for (const [method, p] of [['GET', '/api/tasks'], ['POST', `/api/changesets/${cs3.id}/approve`], ['PATCH', '/api/tasks/TASK-2'], ['DELETE', '/api/meetings/1']] as const) {
    expect((await fetch(sb.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status).toBe(401)
  }
})

test('E: Ask AI — current owner and deadline from the records, the source opens, an unsupported question is not answered', async ({ page }) => {
  await signIn(page, sb, '/ask')
  await main(page).getByLabel('Question').fill('Who currently owns testing and when is it due?')
  const res = page.waitForResponse(r => r.url().endsWith('/api/memory/query'))
  await main(page).getByLabel('Question').press('Enter')
  const body = await (await res).json()
  expect(body.mode).toBe('task_records')
  await expect(main(page).getByText(/owned by Samiksha/)).toBeVisible()
  await expect(main(page).getByText(/TASK-2 is due Mon 26 Oct 2026/)).toBeVisible()
  await main(page).getByRole('link', { name: /segment s3/ }).first().click()
  await expect(page).toHaveURL(/\/meetings\/2#s3$/)
  await expect(page.getByRole('dialog', { name: 'Transcript' }).locator('[data-seg="s3"]')).toContainText('Samiksha takes over the regression tests')
  await page.goto(sb.url + '/ask'); await page.waitForLoadState('networkidle')
  await main(page).getByLabel('Write an answer with the model').uncheck()
  await main(page).getByLabel('Question').fill('What budget was approved for the marketing campaign?')
  await main(page).getByLabel('Question').press('Enter')
  await expect(main(page).getByText('Nothing found in stored meetings')).toBeVisible()
  await expect(main(page).getByText(/Answer from/)).toHaveCount(0)
})

test('F: report — preview and download; the PDF holds the title, summary, actions and the right approval state', async ({ page }) => {
  await signIn(page, sb, '/meetings/2')
  const dl = page.waitForEvent('download')
  await main(page).getByRole('button', { name: 'Download meeting report' }).click()
  const file = path.join(tmpdir(), `judge-report-${Date.now()}.pdf`)
  writeFileSync(file, readFileSync((await (await dl).path())!))
  const text = execFileSync('pdftotext', [file, '-']).toString().split(/\s+/).join(' ')
  const m = await apiFor(sb).get<MeetingDetail>('/api/meetings/2')
  expect(text).toContain(m.title)
  expect(text).toContain('APPROVED')
  expect(text).toContain(m.minutes.summary!.split(/\s+/).slice(0, 8).join(' '))
  for (const t of ['Run regression tests', 'Prepare the rollback runbook', 'Samiksha']) expect(text).toContain(t)
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())![1])
  expect(pages).toBeGreaterThan(1)
  expect(text).toContain(`Page ${pages} of ${pages}`)
  // A pending meeting's report never says approved.
  await page.goto(sb.url + '/meetings/3'); await page.waitForLoadState('networkidle')
  const dl3 = page.waitForEvent('download')
  await main(page).getByRole('button', { name: 'Download meeting report' }).click()
  const f3 = path.join(tmpdir(), `judge-report3-${Date.now()}.pdf`)
  writeFileSync(f3, readFileSync((await (await dl3).path())!))
  const t3 = execFileSync('pdftotext', [f3, '-']).toString()
  expect(t3).toContain('DRAFT: PENDING APPROVAL')
  expect(t3).not.toContain('(approved)')
})

test('G: refreshing during processing shows the same live stages and the transcript, never a blank page', async ({ page }) => {
  const started = new Date(Date.now() - 40_000).toISOString()
  await page.route('**/api/meetings/4', async route => {
    const r = await route.fetch()
    const m = (await r.json()) as MeetingDetail
    m.processing_status = 'interpreting'
    m.processing_log = [...m.processing_log, { at: started, step: 'queue', status: 'ok', detail: 'interpret,minutes' }]
    await route.fulfill({ response: r, json: m })
  })
  await signIn(page, sb, '/meetings/4')
  const steps = main(page).getByRole('list', { name: 'Analysis steps' }).getByRole('listitem')
  await expect(steps.nth(3)).toHaveAttribute('data-state', 'active')
  await page.reload()
  await expect(steps.nth(3)).toHaveAttribute('data-state', 'active')
  await expect(main(page).getByRole('list', { name: 'Transcript' })).toContainText('Kavya, please finish the login screen')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Audio upload check (synthetic TTS)')
})
