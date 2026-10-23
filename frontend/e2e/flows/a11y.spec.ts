// Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on every primary route, in
// both themes, plus the drawers and dialogs that hold primary work.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from '../support/fixtures'
import { startSandbox, type Sandbox } from '../support/sandbox'

const ROUTES = ['/', '/meetings', '/meetings/2', '/meetings/4', '/meetings/new', '/approvals', '/approvals/4', '/approvals/2',
  '/tasks', '/tasks?view=board', '/ask', '/follow-ups', '/follow-ups?tab=calendar', '/follow-ups?tab=reminders', '/follow-ups?tab=notifications', '/diagnostics']

async function audit(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return r.violations.map(v => `${where}: ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`)
}

let sb: Sandbox
test.beforeAll(async () => { sb = await startSandbox('demo', 'a11y') })
test.afterAll(async () => { await sb.stop() })

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations on any route (${theme} theme)`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.addInitScript(t => localStorage.setItem('ps53.theme', t), theme)
    await page.goto(sb.url + '/')
    const found: string[] = await audit(page, 'sign-in')
    await signIn(page, sb)
    for (const path of ROUTES) {
      await page.goto(sb.url + path)
      await page.waitForLoadState('networkidle')
      found.push(...await audit(page, path))
    }
    expect(found).toEqual([])
  })
}

test('no violations inside the approval drawer, the transcript drawer, the task drawer and dialogs', async ({ page }) => {
  await signIn(page, sb, '/approvals/4')
  const found: string[] = []
  await page.locator('tr[data-item="login-screen"]').getByRole('button', { name: 'Finish the login screen' }).click()
  found.push(...await audit(page, 'approval drawer'))
  await page.keyboard.press('Escape')
  await page.getByRole('main').getByRole('button', { name: 'Transcript', exact: true }).click()
  found.push(...await audit(page, 'transcript drawer'))
  await page.keyboard.press('Escape')
  await page.getByRole('main').getByRole('button', { name: 'Reject all', exact: true }).click()
  found.push(...await audit(page, 'reject dialog'))
  await page.keyboard.press('Escape')
  await page.goto(sb.url + '/tasks?task=TASK-2'); await page.waitForLoadState('networkidle')
  found.push(...await audit(page, 'task drawer'))
  await page.goto(sb.url + '/follow-ups?tab=reminders'); await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New reminder' }).click()
  found.push(...await audit(page, 'reminder dialog'))
  expect(found).toEqual([])
})
