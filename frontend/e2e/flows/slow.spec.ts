// Flows that call the live local model (several minutes). They need Ollama with the configured
// model; with no model reachable they fail rather than pretend.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, signIn, clickAnd } from '../support/fixtures'
import { apiFor, startSandbox } from '../support/sandbox'

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../demo')
const main = (page: Page) => page.getByRole('main')

test('upload → processing → re-run → suggestion made a task → approved → on the board', async ({ page }) => {
  test.setTimeout(20 * 60_000)
  const sb = await startSandbox('empty', 'slow-upload')
  try {
    await signIn(page, sb, '/meetings/new')
    await main(page).getByLabel('Meeting title').fill('Planning upload check')
    await main(page).getByLabel('Recording or transcript').setInputFiles(path.join(DEMO, 'synthetic_meeting_1_planning.json'))
    await main(page).getByLabel(/I confirm that every participant agreed/).check()
    await main(page).getByRole('button', { name: 'Analyze meeting' }).click()
    await expect(page).toHaveURL(/\/meetings\/\d+$/)
    const id = Number(page.url().split('/').pop())
    await expect(main(page).getByText(/^Processing: /).first()).toBeVisible()
    await expect(main(page).getByText('Needs review', { exact: true }).or(main(page).getByText('Ready to approve', { exact: true })).first()).toBeVisible({ timeout: 12 * 60_000 })
    // Re-run the analysis of the still-unapproved meeting.
    await main(page).getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Re-run analysis' }).click()
    await clickAnd(page, page.getByRole('dialog').getByRole('button', { name: 'Re-run analysis' }))
    await expect(main(page).getByText(/^Processing: /).first()).toBeVisible()
    await expect(main(page).getByText('Needs review', { exact: true }).or(main(page).getByText('Ready to approve', { exact: true })).first()).toBeVisible({ timeout: 12 * 60_000 })
    await main(page).getByRole('link', { name: 'Review and approve tasks' }).first().click()
    await page.waitForLoadState('networkidle')
    type C = { state: string; proposal: { items: { key: string; state: string; title: string; operation: string; owner: string | null }[]; clarifications: { answer: unknown; deferred: boolean }[] } }
    const c = await apiFor(sb).get<C>(`/api/meetings/${id}/changeset`)
    const sugg = c.proposal.items.find(i => i.state === 'tentative')
    test.skip(!sugg, 'BLOCKED: this model run produced no suggestion to promote')
    await main(page).getByRole('button', { name: /that will not change the board/ }).click()
    await page.locator(`tr[data-item="${sugg!.key}"]`).getByRole('button').first().click()
    const d = page.getByRole('dialog', { name: sugg!.title })
    await d.getByLabel('Owner').fill('Asha')
    await clickAnd(page, d.getByRole('button', { name: 'Add as proposed task' }))
    expect((await apiFor(sb).get<C>(`/api/meetings/${id}/changeset`)).proposal.items.find(i => i.key === sugg!.key)).toMatchObject({ state: 'proposed', operation: 'create', owner: 'Asha' })
    await d.getByRole('button', { name: 'Close' }).click()
    // Approve only if the model run left no open questions; otherwise approval is correctly blocked.
    const now = await apiFor(sb).get<C>(`/api/meetings/${id}/changeset`)
    if (now.state === 'READY_FOR_REVIEW') {
      await clickAnd(page, main(page).getByRole('button', { name: 'Approve', exact: true }))
      expect((await apiFor(sb).get<C>(`/api/meetings/${id}/changeset`)).state).toBe('APPLIED')
      const tasks = await apiFor(sb).get<{ title: string; owner: string | null }[]>('/api/tasks')
      expect(tasks.find(t => t.title === sugg!.title)?.owner).toBe('Asha')
    } else {
      await expect(main(page).getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
      test.info().annotations.push({ type: 'note', description: 'model left open questions; approval correctly blocked' })
    }
  } finally { await sb.stop() }
})

test('ask with the model: an answer only from cited passages, whose citations open the source line', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  const sb = await startSandbox('demo', 'slow-ask')
  try {
    await signIn(page, sb, '/ask')
    await main(page).getByLabel('Question').fill('Who owns the regression tests and when are they due?')
    await main(page).getByRole('button', { name: 'Ask' }).click()
    const outcome = main(page).getByText(/^(Answer from the meeting records|Not supported by the meeting records)$/)
    await expect(outcome).toBeVisible({ timeout: 7 * 60_000 })
    if ((await outcome.innerText()) === 'Answer from the meeting records') {
      await expect(main(page).getByText(/using only the cited passages/)).toBeVisible()
      await main(page).getByRole('link', { name: /segment s\d+/ }).first().click()
      await expect(page).toHaveURL(/#s\d+$/)
    }
  } finally { await sb.stop() }
})

test('ask when the model is down: says so and shows passages, never "nothing found" or an answer', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  const sb = await startSandbox('demo', 'slow-nollm', { OLLAMA_BASE_URL: 'http://127.0.0.1:9', LLM_PROVIDER: 'ollama' })
  try {
    await signIn(page, sb, '/ask')
    await main(page).getByLabel('Question').fill('Who owns the regression tests?')
    await main(page).getByRole('button', { name: 'Ask' }).click()
    await expect(main(page).getByText('Model unavailable', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
    await expect(main(page).getByText(/closest stored passages, not an answer/)).toBeVisible()
    await expect(main(page).getByText('Nothing found in stored meetings')).toHaveCount(0)
    await expect(main(page).getByText('Answer from the meeting records')).toHaveCount(0)
  } finally { await sb.stop() }
})

test('diagnostics live test reports the real result', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const sb = await startSandbox('demo', 'slow-diag')
  try {
    await signIn(page, sb, '/diagnostics')
    await main(page).getByRole('button', { name: 'Run live test' }).click()
    await expect(main(page).getByText(/^passed: ollama|^failed:/)).toBeVisible({ timeout: 4 * 60_000 })
  } finally { await sb.stop() }
})
