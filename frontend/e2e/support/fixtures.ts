// Shared browser-test fixtures. Every test fails on an uncaught exception, a console
// error, or an API response >= 400 that the test did not declare as expected.
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import type { Sandbox } from './sandbox'

export interface Watch {
  pageErrors: string[]; consoleErrors: string[]; apiErrors: string[]; requests: string[]
  /** Declare an expected failing API call, e.g. allow(/approve 409/). */
  allow: (re: RegExp) => void
}

export function watchPage(page: Page): Watch & { unexpected: () => string[] } {
  const allowed: RegExp[] = []
  const w = {
    pageErrors: [] as string[], consoleErrors: [] as string[], apiErrors: [] as string[], requests: [] as string[],
    allow: (re: RegExp) => { allowed.push(re) },
    unexpected: () => w.apiErrors.filter(e => !allowed.some(a => a.test(e))),
  }
  page.on('pageerror', e => w.pageErrors.push(e.message))
  page.on('console', m => {
    // Network failures are tracked (and allowed) per request below.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) w.consoleErrors.push(m.text())
  })
  page.on('request', r => { if (r.url().includes('/api/')) w.requests.push(`${r.method()} ${new URL(r.url()).pathname}`) })
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/api/')) w.apiErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`)
  })
  page.on('requestfailed', r => {
    const why = r.failure()?.errorText ?? ''
    // ERR_CONNECTION_REFUSED only happens after a sandbox has been stopped at the end of a test.
    if (r.url().includes('/api/') && !/ERR_ABORTED|NS_BINDING_ABORTED|ERR_CONNECTION_REFUSED/.test(why)) w.apiErrors.push(`${r.method()} ${new URL(r.url()).pathname} ${why}`)
  })
  return w
}

// The presentation intro plays on every page load. Tests that are not about it skip it the way
// a person would, by pressing its "Skip intro" button as soon as it appears.
const SKIP_INTRO = () => {
  const skip = () => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Skip intro')
    if (b) b.click()
    return !!b
  }
  const watchFor = () => {
    if (skip()) return
    const obs = new MutationObserver(() => { if (skip()) obs.disconnect() })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => obs.disconnect(), 10_000)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchFor)
  else watchFor()
}

export const test = base.extend<{ watch: Watch; keepIntro: boolean }>({
  keepIntro: [false, { option: true }],
  page: async ({ page, keepIntro }, use) => {
    if (!keepIntro) await page.addInitScript(SKIP_INTRO)
    await use(page)
  },
  watch: [async ({ page }, use) => {
    const w = watchPage(page)
    await use(w)
    expect(w.pageErrors, 'uncaught exceptions in the page').toEqual([])
    expect(w.consoleErrors, 'console errors').toEqual([])
    expect(w.unexpected(), 'unexpected failing API requests').toEqual([])
  }, { auto: true }],
})
export { expect }

export const TOKEN_KEY = 'ps53.organiserToken'

export async function signIn(page: Page, sb: Sandbox, path = '/') {
  await page.goto(sb.url + '/')
  await page.getByLabel('Organiser token').fill(sb.token)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('main')).toBeVisible()
  if (path !== '/') await page.goto(sb.url + path)
  await page.waitForLoadState('networkidle')
}

/** Count of API calls matching a pattern seen so far. */
export const calls = (w: Watch, re: RegExp) => w.requests.filter(r => re.test(r)).length

/** Click, then wait until the write request it triggers (any non-GET /api call) has answered
 *  and the page has gone quiet again. Returns the response so callers can check its status. */
export async function clickAnd(page: Page, target: Locator, match: RegExp = /^(POST|PUT|PATCH|DELETE) \/api\//, dbl = false) {
  const resp = page.waitForResponse(r => match.test(`${r.request().method()} ${new URL(r.url()).pathname}`), { timeout: 30_000 })
  if (dbl) await target.dblclick(); else await target.click()
  const r = await resp
  await page.waitForLoadState('networkidle')
  return r
}
