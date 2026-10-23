// Sign-in, session handling, navigation, secondary menu, theme, old addresses, phone menu,
// empty database. Read-only checks share one sandbox; nothing here writes data.
import type { Page } from '@playwright/test'
import { test, expect, signIn, TOKEN_KEY } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const more = (page: Page) => page.getByRole('complementary').getByRole('button', { name: 'More' })
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true })

test.describe('with the demo data', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('demo', 'shell') })
  test.afterAll(async () => { await sb.stop() })

  test('sign-in: disabled until typed; a wrong token is refused and not kept; a valid one opens Overview', async ({ page, watch }) => {
    watch.allow(/GET \/api\/meetings 401/)
    await page.goto(sb.url + '/')
    const btn = page.getByRole('button', { name: 'Sign in' })
    await expect(btn).toBeDisabled()
    await page.getByLabel('Organiser token').fill('wrong-token')
    await btn.click()
    await expect(page.getByRole('alert')).toContainText('invalid organiser token')
    await expect(page.getByText('You were signed out')).toHaveCount(0)
    expect(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull()
    await signIn(page, sb)
    await expect(h1(page, 'Overview')).toBeVisible()
  })

  test('a deep link without a session shows sign-in and requests no protected data; the API refuses without a token', async ({ page, watch }) => {
    await page.goto(sb.url + '/tasks')
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    expect(watch.requests).toEqual([])
    for (const p of ['/api/meetings', '/api/tasks', '/api/changesets', '/api/reminders', '/api/memory/search?q=x']) expect((await fetch(sb.url + p)).status).toBe(401)
  })

  test('a rotated or expired token returns to sign-in and says why', async ({ page, watch }) => {
    watch.allow(/ 401$/)
    await signIn(page, sb)
    await page.evaluate(k => sessionStorage.setItem(k, 'rotated-token'), TOKEN_KEY)
    await nav(page).getByRole('link', { name: /^Tasks/ }).click()
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'You were signed out' })).toContainText('no longer accepts the organiser token')
    await signIn(page, sb)
    await expect(page.getByText('You were signed out')).toHaveCount(0)
  })

  test('every destination opens its page; counts match the API; Diagnostics is in the secondary menu', async ({ page }) => {
    await signIn(page, sb)
    const cs = await apiFor(sb).get<{ state: string }[]>('/api/changesets')
    const tasks = await apiFor(sb).get<{ status: string }[]>('/api/tasks')
    const waiting = cs.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)).length
    const open = tasks.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).length
    await expect(nav(page).getByRole('link', { name: new RegExp(`^Approvals\\s*${waiting} waiting$`) })).toBeVisible()
    await expect(nav(page).getByRole('link', { name: new RegExp(`^Tasks\\s*${open} open$`) })).toBeVisible()
    for (const [link, heading] of [['Overview', 'Overview'], ['Meetings', 'Meetings'], ['Approvals', 'Approvals'], ['Tasks', 'Tasks'], ['Ask AI', 'Ask AI'], ['Follow-ups', 'Follow-ups']]) {
      await nav(page).getByRole('link', { name: new RegExp(`^${link}`) }).click()
      await expect(h1(page, heading)).toBeVisible()
      await expect(nav(page).getByRole('link', { name: new RegExp(`^${link}`) })).toHaveAttribute('aria-current', 'page')
    }
    await expect(nav(page).getByRole('link', { name: /Diagnostics/ })).toHaveCount(0)
    await more(page).click()
    await page.getByRole('menuitem', { name: 'Diagnostics' }).click()
    await expect(h1(page, 'Diagnostics')).toBeVisible()
  })

  test('the secondary menu works from the keyboard and closes on Escape', async ({ page }) => {
    await signIn(page, sb)
    await more(page).focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'More' })
    await expect(menu).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Diagnostics' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: /Switch to (light|dark) theme/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(more(page)).toBeFocused()
  })

  test('theme switches from the menu and persists after reload', async ({ page }) => {
    await signIn(page, sb)
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
    const before = await theme()
    await more(page).click()
    await page.getByRole('menuitem', { name: /Switch to (light|dark) theme/ }).click()
    expect(await theme()).not.toBe(before)
    await page.reload()
    expect(await theme()).not.toBe(before)
  })

  test('sign out clears the token', async ({ page }) => {
    await signIn(page, sb)
    await more(page).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    expect(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull()
  })

  test('unknown routes land on Overview; earlier addresses redirect to their new pages', async ({ page }) => {
    await signIn(page, sb, '/no-such-page')
    await expect(h1(page, 'Overview')).toBeVisible()
    for (const [from, to, heading] of [['/review', /\/approvals$/, 'Approvals'], ['/review/4', /\/approvals\/4$/, 'Audio upload check (synthetic TTS)'],
      ['/memory', /\/ask$/, 'Ask AI'], ['/follow-up', /\/follow-ups\?tab=reminders$/, 'Follow-ups'], ['/agenda', /\/follow-ups$/, 'Follow-ups']] as [string, RegExp, string][]) {
      await page.goto(sb.url + from)
      await expect(page).toHaveURL(to)
      await expect(h1(page, heading)).toBeVisible()
    }
  })

  test('phone: the menu opens, a destination closes it, and the secondary items are in it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, sb)
    await page.getByRole('button', { name: 'Menu' }).click()
    await nav(page).getByRole('link', { name: /^Tasks/ }).click()
    await expect(h1(page, 'Tasks')).toBeVisible()
    await expect(nav(page)).toBeHidden()
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('button', { name: 'Diagnostics' }).click()
    await expect(h1(page, 'Diagnostics')).toBeVisible()
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('button', { name: /Switch to (light|dark) theme/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('a notification can be dismissed', async ({ page, watch }) => {
    watch.allow(/calendar\.ics 500/)
    await signIn(page, sb, '/follow-ups?tab=calendar')
    await page.route('**/api/calendar.ics', r => r.fulfill({ status: 500, body: '{"detail":"calendar export failed"}', contentType: 'application/json' }))
    await page.getByRole('button', { name: 'Export calendar (.ics)' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'calendar export failed' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Dismiss' }).click()
    await expect(toast).toHaveCount(0)
  })
})

test.describe('error recovery', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('demo', 'shell-errors') })
  test.afterAll(async () => { await sb.stop() })

  test('a page whose data fails to load says so, and "Try again" recovers once the server answers', async ({ page, watch }) => {
    watch.allow(/GET \/api\/tasks 503/)
    await signIn(page, sb)
    await page.route('**/api/tasks', r => r.fulfill({ status: 503, body: '{"detail":"database is locked"}', contentType: 'application/json' }))
    await page.goto(sb.url + '/tasks')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('database is locked')
    await page.unroute('**/api/tasks')
    await page.getByRole('main').getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('row', { name: /TASK-2/ })).toBeVisible()
  })

  test('a server that cannot be reached is reported as such', async ({ page, watch }) => {
    watch.allow(/GET \/api\/meetings/)
    await signIn(page, sb)
    await page.route('**/api/meetings', r => r.abort('connectionrefused'))
    await page.goto(sb.url + '/meetings')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Cannot reach the server')
  })
})

test.describe('with an empty database', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('empty', 'shell-empty') })
  test.afterAll(async () => { await sb.stop() })

  test('every page shows a sensible empty state with a way forward', async ({ page }) => {
    await signIn(page, sb)
    await expect(page.getByText(/No meetings yet/)).toBeVisible()
    for (const [path, text] of [['/meetings', /No meetings yet/], ['/approvals', /No proposed changes yet/], ['/tasks', /No approved tasks yet/],
      ['/follow-ups', /Nothing to raise/], ['/follow-ups?tab=calendar', /Approved tasks with a due date/], ['/follow-ups?tab=reminders', /No reminders yet/],
      ['/follow-ups?tab=notifications', /No reminder has fired yet/], ['/ask', /Ask about owners/], ['/diagnostics', /Language model/]] as [string, RegExp][]) {
      await page.goto(sb.url + path)
      await expect(page.getByText(text).first()).toBeVisible()
    }
    await page.goto(sb.url + '/approvals')
    await page.getByRole('main').getByRole('link', { name: 'Add a meeting' }).click()
    await expect(h1(page, 'New meeting')).toBeVisible()
  })
})
