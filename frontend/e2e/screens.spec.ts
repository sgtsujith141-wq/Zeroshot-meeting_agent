import { expect, test } from '@playwright/test'

// Read-only screenshots of every main screen for visual QA. Enabled with SCREENS=1.
const TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = process.env.SHOT_DIR ?? 'test-results/screens'
const W = Number(process.env.VW ?? 1440)
const THEME = process.env.THEME // 'light' to capture the light theme
const ROUTES: [string, string][] = [
  ['/', 'dashboard'], ['/review/2', 'review-m2'], ['/review/4', 'review-m4'], ['/meetings/2', 'meeting-m2'],
  ['/meetings/4', 'meeting-m4'], ['/tasks', 'tasks'], ['/memory', 'memory'], ['/follow-up', 'follow-up'],
  ['/agenda', 'agenda'], ['/diagnostics', 'diagnostics'], ['/meetings/new', 'new-meeting'], ['/review', 'review-list'],
]

test('screens', async ({ page }) => {
  test.skip(!process.env.SCREENS || !TOKEN, 'set SCREENS=1 and E2E_TOKEN')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: W, height: W < 600 ? 844 : 900 })
  if (THEME) await page.addInitScript(t => localStorage.setItem('ps53.theme', t), THEME)
  const tag = THEME ? `${W}-${THEME}` : `${W}`
  await page.goto('/')
  await page.screenshot({ path: `${SHOTS}/${tag}-signin.png`, animations: 'disabled' })
  await page.getByLabel('Organiser token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('main')).toBeVisible()
  for (const [path, name] of ROUTES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect.soft(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, fullPage: true, animations: 'disabled' })
  }
})
