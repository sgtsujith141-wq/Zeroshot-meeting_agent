// Presentation intro, the meeting results page, the processing view, the synthetic demo
// transcript and the fast Ask path. Read-only checks share one demo sandbox; the upload test
// uses its own sandbox with the model switched off, so it never calls a real model.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, signIn, TOKEN_KEY } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'
import type { MeetingDetail } from '../../src/types'

const main = (page: Page) => page.getByRole('main')
const intro = (page: Page) => page.getByRole('main', { name: 'Presentation introduction' })

test.describe('with the demo data', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('demo', 'final-ui') })
  test.afterAll(async () => { await sb.stop() })

  test.describe('intro', () => {
    test.use({ keepIntro: true }) // these tests watch the intro, so it is not skipped
    test('intro: plays on every load; Space steps through the lines; Enter workspace drops the parameter', async ({ page, watch }) => {
      await page.goto(sb.url + '/')
      await expect(intro(page)).toBeVisible()
      await page.reload()
      await expect(intro(page)).toBeVisible() // a refresh plays it again
      await page.goto(sb.url + '/?present=1')
      await expect(intro(page)).toContainText('AI can already write the minutes.')
      expect(watch.requests, 'the intro requests no data').toEqual([])
      await page.keyboard.press('Space')
      await expect(intro(page)).toContainText('But meetings don’t fail because')
      await page.keyboard.press('Space')
      await expect(intro(page)).toContainText('we forget what was said.')
      await page.keyboard.press('Space')
      await expect(intro(page)).toContainText('They fail because work gets lost afterward.')
      await page.keyboard.press('Space')
      await expect(page.getByRole('heading', { level: 1, name: 'Meeting Actions' })).toBeVisible()
      await expect(intro(page)).toContainText('From conversation to completed work.')
      await page.getByRole('button', { name: 'Enter workspace' }).click()
      await expect(intro(page)).toHaveCount(0)
      expect(new URL(page.url()).search).toBe('')
      await expect(page.getByLabel('Organiser token')).toBeVisible() // not signed in: the normal sign-in
    })

    test('intro: Skip intro and Esc leave at once; a signed-in presenter lands on the workspace', async ({ page }) => {
      await page.goto(sb.url + '/?present=1')
      await page.getByRole('button', { name: 'Skip intro' }).click()
      await expect(intro(page)).toHaveCount(0)
      await page.evaluate(([k, t]) => sessionStorage.setItem(k, t), [TOKEN_KEY, sb.token])
      await page.goto(sb.url + '/?present=1')
      await expect(intro(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { level: 1, name: 'Meeting Actions' })).toBeVisible()
      await expect(intro(page)).toHaveCount(0)
    })
  })

  test('intro: with reduced motion the lines still read and the linework is static', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' }) // a new context: the intro is not skipped
    const page = await ctx.newPage()
    await page.goto(sb.url + '/?present=1')
    await expect(intro(page)).toContainText('AI can already write the minutes.')
    const offset = await page.locator('main svg path').first().evaluate(el => getComputedStyle(el).strokeDashoffset)
    expect(offset).toBe('450px')
    await ctx.close()
  })

  test('workspace: real sections, synthetic meetings labelled, rows open their records', async ({ page }) => {
    await signIn(page, sb)
    await expect(page.getByRole('heading', { level: 1, name: 'Meeting Actions' })).toBeVisible()
    await expect(main(page).getByText('From meetings to work that gets done.')).toBeVisible()
    await expect(main(page).getByRole('link', { name: 'Record or upload a meeting' })).toBeVisible()
    for (const s of ['Meetings awaiting review', 'Upcoming tasks', 'Recently processed meetings']) await expect(main(page).getByRole('heading', { level: 2, name: s })).toBeVisible()
    const review = main(page).getByRole('region', { name: /Meetings awaiting review/ })
    await expect(review.getByRole('listitem')).toHaveCount(2) // meetings 3 and 4 wait for approval in the demo data
    await expect(review.getByText('SYNTHETIC', { exact: true })).toHaveCount(2)
    await review.getByRole('link', { name: /Payments status, code-mixed/ }).click()
    await expect(page).toHaveURL(/\/approvals\/3$/)
  })

  test('results page: summary, discussions, decisions, action items and questions; evidence opens the transcript', async ({ page }) => {
    await signIn(page, sb, '/meetings/1')
    for (const s of ['Meeting summary', 'Key discussions', 'Decisions made', 'Action items', 'Questions to clarify'])
      await expect(main(page).getByRole('heading', { level: 2, name: new RegExp(`^${s}`) })).toBeVisible()
    const table = main(page).getByRole('table')
    for (const h of ['Task', 'Owner', 'Due', 'Priority', 'Dependency']) await expect(table.getByRole('columnheader', { name: h, exact: true })).toBeVisible()
    await expect(table.getByRole('row', { name: /Run regression tests/ })).toContainText('Finish the refund API')
    await expect(main(page).getByText('Do we need finance sign-off before enabling refunds for all users?')).toBeVisible()
    // Internal vocabulary stays out of the results page.
    await expect(main(page)).not.toContainText(/change set|ledger|proposal hash|version \d|event folding/i)
    await main(page).getByRole('button', { name: 'Show s5 in transcript' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'Transcript' })
    await expect(drawer.locator('[data-seg="s5"]')).toHaveClass(/seg-flash/)
    await expect(drawer.locator('[data-seg="s5"]')).toContainText('keep Stripe')
  })

  test('results page: "Download meeting report" saves the PDF built from this meeting', async ({ page }) => {
    await signIn(page, sb, '/meetings/2')
    const dl = page.waitForEvent('download')
    await main(page).getByRole('button', { name: 'Download meeting report' }).click()
    const file = await dl
    expect(file.suggestedFilename()).toMatch(/report\.pdf$/)
    const bytes = readFileSync((await file.path())!)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('results page: a meeting waiting for approval offers "Review and approve tasks"', async ({ page }) => {
    await signIn(page, sb, '/meetings/3')
    await main(page).getByRole('link', { name: 'Review and approve tasks' }).first().click()
    await expect(page).toHaveURL(/\/approvals\/3$/)
  })

  test('approvals: changes read as before → after, without version numbers', async ({ page }) => {
    await signIn(page, sb, '/approvals/3')
    await expect(main(page)).not.toContainText(/Version \d/)
    // Demo meeting 3 reports TASK-4 done: one line, current value → proposed value.
    const row = main(page).getByRole('row', { name: /Prepare the rollback runbook/ })
    await expect(row.getByRole('listitem')).toHaveText(['Status: To do→ changes to Done'])
    await expect(main(page).getByRole('row', { name: /finance sign-off/i }).getByRole('listitem').first()).toHaveText('Owner: Priya')
  })

  test('processing view: five stages from the real status, real elapsed time, the transcript below, and a labelled earlier sample', async ({ page }) => {
    // The meeting record is the server's own, with its status set to "interpreting" and this
    // run's log entries, as the backend writes them while a model call is in flight.
    const started = new Date(Date.now() - 75_000).toISOString()
    await page.route('**/api/meetings/4', async route => {
      const r = await route.fetch()
      const m = (await r.json()) as MeetingDetail
      m.processing_status = 'interpreting'
      m.created_at = new Date().toISOString()
      m.processing_log = [...m.processing_log, { at: started, step: 'queue', status: 'ok', detail: 'transcribe,interpret,minutes' },
        { at: new Date(Date.now() - 30_000).toISOString(), step: 'transcribe', status: 'ok', detail: '9 segments' }]
      await route.fulfill({ response: r, json: m })
    })
    await signIn(page, sb, '/meetings/4')
    const steps = main(page).getByRole('list', { name: 'Analysis steps' }).getByRole('listitem')
    await expect(steps).toHaveText([/Audio received/, /Transcription/, /Transcript ready/, /Extracting decisions and actions/, /Preparing meeting results/])
    await expect(steps.nth(0)).toHaveAttribute('data-state', 'done')
    await expect(steps.nth(1)).toHaveAttribute('data-state', 'done')
    await expect(steps.nth(1)).toContainText(/Done in 0:4[45], whisper-local/)
    await expect(steps.nth(2)).toHaveAttribute('data-state', 'done')
    await expect(steps.nth(3)).toHaveAttribute('data-state', 'active')
    await expect(steps.nth(3)).toContainText(/Running for 0:3\d/)
    await expect(steps.nth(4)).toHaveAttribute('data-state', 'todo')
    // The transcript is readable while the model works, but not editable.
    await expect(main(page).getByRole('list', { name: 'Transcript' })).toContainText('Kavya, please finish the login screen')
    await expect(main(page).getByRole('button', { name: /^Correct s/ })).toHaveCount(0)
    await expect(main(page)).not.toContainText('%')
    const sample = main(page).getByRole('link', { name: 'Open a sample processed earlier' })
    await expect(main(page).getByText(/It is not the result of this upload/)).toBeVisible()
    await sample.click()
    await expect(page).not.toHaveURL(/\/meetings\/4$/)
    await expect(main(page).getByText('SYNTHETIC', { exact: true }).first()).toBeVisible()
  })

  test('ask: a task-state question is answered from the approved records, without the model, with its latency', async ({ page }) => {
    await signIn(page, sb, '/ask')
    await main(page).getByLabel('Question').fill('Who owns the regression tests?')
    const res = page.waitForResponse(r => r.url().endsWith('/api/memory/query'))
    await main(page).getByRole('button', { name: 'Ask', exact: true }).click()
    const body = await (await res).json()
    expect(body.mode).toBe('task_records')
    expect(body.llm).toBeUndefined()
    await expect(main(page).getByText('Answer from approved task records')).toBeVisible()
    await expect(main(page).getByText(/owned by Samiksha/)).toBeVisible()
    await expect(main(page).getByText(/^Answered in \d+(\.\d)? (ms|s)$/)).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'Where this was agreed' })).toBeVisible()
  })

  test('ask: suggestions come from the stored tasks and each one is answered', async ({ page }) => {
    await signIn(page, sb, '/ask')
    await main(page).getByRole('button', { name: 'What is still pending?' }).click()
    await expect(main(page).getByText('Answer from approved task records')).toBeVisible()
    await expect(main(page).getByText(/3 open tasks: TASK-2/)).toBeVisible()
  })
})

test('new meeting: the synthetic demo transcript uploads and opens the processing view (model switched off)', async ({ page, watch }) => {
  const sb = await startSandbox('empty', 'final-upload', { OLLAMA_BASE_URL: 'http://127.0.0.1:9', LLM_PROVIDER: 'ollama' })
  try {
    await signIn(page, sb, '/meetings/new')
    await main(page).getByRole('radio', { name: /Upload transcript/ }).click()
    await main(page).getByRole('button', { name: 'Use the synthetic demo transcript' }).click()
    await expect(main(page).getByText('synthetic_meeting_1_planning.json')).toBeVisible()
    await expect(main(page).getByText('SYNTHETIC', { exact: true })).toBeVisible()
    await expect(main(page).getByLabel('Meeting title')).toHaveValue('Payments release planning (synthetic)')
    const go = main(page).getByRole('button', { name: 'Analyze meeting' })
    await expect(go).toBeDisabled()
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    await go.click()
    await expect(page).toHaveURL(/\/meetings\/\d+$/)
    // With no model reachable the analysis stops at the first model step and says so; the
    // transcript stays readable, correctable and downloadable, and the analysis can be retried.
    const steps = main(page).getByRole('list', { name: 'Analysis steps' }).getByRole('listitem')
    await expect(steps.nth(3)).toHaveAttribute('data-state', 'failed', { timeout: 20_000 })
    await expect(steps.nth(1)).toContainText('Not needed: a transcript was uploaded')
    await expect(steps.nth(2)).toContainText('8 lines, shown below')
    await expect(main(page).getByRole('heading', { name: 'Transcription complete; AI analysis unavailable.' })).toBeVisible()
    await expect(main(page).getByRole('list', { name: 'Transcript' }).getByRole('listitem')).toHaveCount(8)
    await expect(main(page).getByRole('button', { name: 'Retry analysis' })).toBeEnabled()
    await expect(main(page).getByRole('button', { name: 'Correct s1' })).toBeVisible()
    const dl = page.waitForEvent('download')
    await main(page).getByRole('button', { name: 'Download transcript' }).click()
    expect((await dl).suggestedFilename()).toMatch(/transcript\.txt$/)
    const [m] = await apiFor(sb).get<{ id: number; file_name: string; segments: number }[]>('/api/meetings')
    expect(m.file_name).toBe('synthetic_meeting_1_planning.json')
    expect(m.segments).toBe(8)
    expect(watch.requests.filter(r => /^POST \/api\/meetings\/\d+\/upload$/.test(r))).toHaveLength(1)
  } finally { await sb.stop() }
})
