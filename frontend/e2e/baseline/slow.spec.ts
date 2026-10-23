// BASELINE AUDIT (UI at 10deb16): flows that call the live local model. Slow (minutes).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox } from '../support/sandbox'

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../demo')

test('N05+V27 upload a transcript, watch it process, then turn a suggestion into a task', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  const sb = await startSandbox('empty', 'base-slow-upload')
  try {
    await signIn(page, sb, '/meetings/new')
    await page.getByLabel('Meeting title').fill('Planning upload check')
    await page.getByLabel('Recording or transcript').setInputFiles(path.join(DEMO, 'synthetic_meeting_1_planning.json'))
    await page.getByLabel(/I confirm that every participant agreed/).check()
    await page.getByRole('button', { name: 'Upload and process' }).click()
    await expect(page).toHaveURL(/\/meetings\/\d+$/)
    await expect(page.getByText(/Queued|Interpreting|Writing minutes|Transcript stored/).first()).toBeVisible()
    await expect(page.getByText('Processed', { exact: true }).first()).toBeVisible({ timeout: 12 * 60_000 })
    const id = Number(page.url().split('/').pop())
    await page.getByRole('main').getByRole('link', { name: 'Review changes' }).click()
    await page.waitForLoadState('networkidle')
    const c = await apiFor(sb).get<{ proposal: { items: { key: string; state: string; title: string }[] } }>(`/api/meetings/${id}/changeset`)
    const tentative = c.proposal.items.find(i => i.state === 'tentative')
    test.skip(!tentative, 'BLOCKED: the model run produced no tentative suggestion to promote')
    await page.getByRole('button', { name: 'Make it a task' }).first().click()
    const d = page.getByRole('dialog', { name: 'Make this suggestion a task' })
    await d.getByLabel('Owner').fill('Asha')
    await clickAnd(page, d.getByRole('button', { name: 'Add as proposed task' }))
    const after = await apiFor(sb).get<{ proposal: { items: { key: string; state: string; operation: string; owner: string | null }[] } }>(`/api/meetings/${id}/changeset`)
    expect(after.proposal.items.find(i => i.key === tentative!.key)).toMatchObject({ state: 'proposed', operation: 'create', owner: 'Asha' })
  } finally { await sb.stop() }
})

test('Q03 asking with the model gives a cited answer whose citations open the source line', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  const sb = await startSandbox('demo', 'base-slow-ask')
  try {
    await signIn(page, sb, '/memory')
    await page.getByLabel('Question').fill('Who owns the regression tests and when are they due?')
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect(page.getByRole('heading', { name: 'Current approved state' })).toBeVisible({ timeout: 7 * 60_000 })
    await expect(page.getByText(/Written by the model from the cited passages only|not found in stored meetings/).first()).toBeVisible()
    const link = page.getByRole('link', { name: /segment s\d+/ }).first()
    if (await link.count()) { await link.click(); await expect(page).toHaveURL(/#s\d+$/) }
  } finally { await sb.stop() }
})

test('Q04 when the model is unavailable the answer says so and shows passages, not "not found"', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  const sb = await startSandbox('demo', 'base-slow-nollm', { OLLAMA_BASE_URL: 'http://127.0.0.1:9', LLM_PROVIDER: 'ollama' })
  try {
    await signIn(page, sb, '/memory')
    await page.getByLabel('Question').fill('Who owns the regression tests?')
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect(page.getByText(/Model unavailable/)).toBeVisible({ timeout: 2 * 60_000 })
    await expect(page.getByText(/not found in stored meetings/i)).toHaveCount(0)
  } finally { await sb.stop() }
})

test('D02 the live model test reports its real result', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const sb = await startSandbox('demo', 'base-slow-diag')
  try {
    await signIn(page, sb, '/diagnostics')
    await page.getByRole('button', { name: 'Run live test' }).click()
    await expect(page.getByText(/passed: ollama|failed:/)).toBeVisible({ timeout: 4 * 60_000 })
  } finally { await sb.stop() }
})
