// Viewport screenshots of every primary route at one width (VW, default 1440), on a sandbox
// copy of the demo data. Enabled with SCREENS=1. Checks horizontal overflow on every route.
import { test, expect, signIn } from './support/fixtures'
import { startSandbox, type Sandbox } from './support/sandbox'

const SHOTS = process.env.SHOT_DIR ?? 'test-results/screens'
const W = Number(process.env.VW ?? 1440)
const THEME = process.env.THEME
const ROUTES: [string, string][] = [
  ['/', 'overview'], ['/meetings', 'meetings'], ['/meetings/2', 'meeting-2'], ['/meetings/4', 'meeting-4'], ['/meetings/new', 'new-meeting'],
  ['/approvals', 'approvals'], ['/approvals/4', 'approval-4'], ['/approvals/3', 'approval-3'], ['/approvals/2', 'approval-2'],
  ['/tasks', 'tasks'], ['/tasks?view=board', 'tasks-board'], ['/tasks?task=TASK-2', 'task-drawer'], ['/ask', 'ask'],
  ['/follow-ups', 'follow-ups'], ['/follow-ups?tab=calendar', 'calendar'], ['/follow-ups?tab=reminders', 'reminders'], ['/follow-ups?tab=notifications', 'notifications'],
  ['/diagnostics', 'diagnostics'],
]

test.describe('screens', () => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1')
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('demo', 'screens') })
  test.afterAll(async () => { await sb.stop() })

  test(`every route at ${W}px`, async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: W, height: W < 600 ? 844 : 900 })
    if (THEME) await page.addInitScript(t => localStorage.setItem('ps53.theme.choice', t), THEME)
    const tag = THEME ? `${W}-${THEME}` : `${W}`
    await page.goto(sb.url + '/')
    await page.screenshot({ path: `${SHOTS}/${tag}-signin.png`, animations: 'disabled' })
    await signIn(page, sb)
    for (const [path, name] of ROUTES) {
      await page.goto(sb.url + path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(250)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect.soft(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
      // No control may be cut off, even inside a horizontally scrolling table.
      const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a, main input, main select')]
        .filter(e => e.offsetParent && e.getClientRects().length)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) })
        .map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40)))
      expect.soft(clipped, `controls cut off on ${path}`).toEqual([])
      await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, animations: 'disabled' })
      const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 1.3)
      if (tall && !path.includes('task=')) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(200)
        await page.screenshot({ path: `${SHOTS}/${tag}-${name}-end.png`, animations: 'disabled' })
      }
    }
  })
})
