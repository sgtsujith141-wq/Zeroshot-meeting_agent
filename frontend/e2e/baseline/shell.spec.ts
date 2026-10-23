// BASELINE AUDIT of the UI at commit 10deb16 (before the UX rebuild). Each test asserts the
// EXPECTED behaviour of one control; a failure records the gap. Sandboxes only.
import { test, expect, signIn, TOKEN_KEY } from '../support/fixtures'
import { apiFor, startSandbox, type Sandbox } from '../support/sandbox'

test.describe('shell and navigation (demo copy)', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('demo', 'base-shell') })
  test.afterAll(async () => { await sb.stop() })

  test('S01 Sign in is disabled until a token is typed', async ({ page }) => {
    await page.goto(sb.url + '/')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await page.getByLabel('Organiser token').fill('x')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  test('S02 a wrong token is refused with the server message and not kept', async ({ page, watch }) => {
    watch.allow(/GET \/api\/meetings 401/)
    await page.goto(sb.url + '/')
    await page.getByLabel('Organiser token').fill('wrong-token')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText('invalid organiser token')
    expect(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull()
  })

  test('S03 a valid token opens the workspace', async ({ page }) => {
    await signIn(page, sb)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('S04 a deep link without a session shows sign-in and requests no protected data', async ({ page, watch }) => {
    await page.goto(sb.url + '/tasks')
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    expect(watch.requests.filter(r => !r.includes('/api/health'))).toEqual([])
  })

  test('S05 the API refuses requests without a token', async () => {
    for (const p of ['/api/meetings', '/api/tasks', '/api/changesets', '/api/reminders']) expect((await fetch(sb.url + p)).status).toBe(401)
  })

  test('S06 an expired or rotated token returns to sign-in and says why', async ({ page, watch }) => {
    watch.allow(/ 401$/)
    await signIn(page, sb)
    await page.evaluate(k => sessionStorage.setItem(k, 'rotated-token'), TOKEN_KEY)
    await page.getByRole('link', { name: /Task board/ }).first().click()
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    await expect(page.getByText(/session|signed out|no longer valid|sign in again/i)).toBeVisible({ timeout: 3000 })
  })

  test('S07 every sidebar destination opens its page and badge counts match the API', async ({ page }) => {
    await signIn(page, sb)
    const cs = await apiFor(sb).get<{ state: string }[]>('/api/changesets')
    const tasks = await apiFor(sb).get<{ status: string }[]>('/api/tasks')
    const pending = cs.filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state)).length
    const open = tasks.filter(t => ['todo', 'in_progress', 'blocked'].includes(t.status)).length
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: new RegExp(`^Review changes\\W+${pending} pending`) })).toBeVisible()
    await expect(nav.getByRole('link', { name: new RegExp(`^Task board\\W+${open} open`) })).toBeVisible()
    for (const [link, h] of [['Overview', 'Overview'], ['Review changes', 'Review changes'], ['Task board', 'Task board'],
      ['Calendar & reminders', 'Calendar and reminders'], ['Next agenda', 'Next meeting agenda'], ['Ask past meetings', 'Ask past meetings'], ['Diagnostics', 'Diagnostics']]) {
      await nav.getByRole('link', { name: new RegExp(`^${link}`) }).click()
      await expect(page.getByRole('heading', { level: 1, name: h })).toBeVisible()
    }
  })

  test('S08 brand link returns to Overview and New meeting opens the upload form', async ({ page }) => {
    await signIn(page, sb, '/tasks')
    await page.getByRole('link', { name: 'New meeting' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a meeting' })).toBeVisible()
    await page.getByRole('link', { name: /Meeting actions/ }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  })

  test('S09 theme toggle switches and persists after reload', async ({ page }) => {
    await signIn(page, sb)
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
    const before = await theme()
    await page.getByRole('button', { name: before === 'dark' ? 'Light' : 'Dark' }).click()
    expect(await theme()).not.toBe(before)
    await page.reload()
    expect(await theme()).not.toBe(before)
  })

  test('S10 sign out clears the token and shows sign-in', async ({ page }) => {
    await signIn(page, sb)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Organiser token')).toBeVisible()
    expect(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull()
  })

  test('S11 an unknown route lands on Overview', async ({ page }) => {
    await signIn(page, sb, '/no-such-page')
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  })

  test('S12 phone: menu opens, a destination closes it, the New meeting icon works', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, sb)
    await page.getByRole('button', { name: 'Menu' }).click()
    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('link', { name: /^Task board/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Task board' })).toBeVisible()
    await expect(nav).toBeHidden()
    await page.getByRole('link', { name: 'New meeting' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a meeting' })).toBeVisible()
  })

  test('O01 Overview review queue matches the API and opens each review', async ({ page }) => {
    await signIn(page, sb)
    const cs = (await apiFor(sb).get<{ meeting_id: number; meeting_title: string; state: string }[]>('/api/changesets'))
      .filter(c => ['NEEDS_CLARIFICATION', 'READY_FOR_REVIEW'].includes(c.state))
    for (const c of cs) {
      await page.goto(sb.url + '/')
      await page.getByRole('link', { name: new RegExp(c.meeting_title.replace(/[()]/g, '.')) }).first().click()
      await expect(page).toHaveURL(new RegExp(`/review/${c.meeting_id}$`))
    }
  })

  test('O02 "Review N pending" opens the review list', async ({ page }) => {
    await signIn(page, sb)
    await page.getByRole('link', { name: /^Review \d+ pending/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Review changes' })).toBeVisible()
  })

  test('O03 an upcoming-deadline row opens that task', async ({ page }) => {
    await signIn(page, sb)
    await page.getByText('Update the release notes').first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 })
  })

  test('O05 meeting table: title, review state and arrow all link to the right place', async ({ page }) => {
    await signIn(page, sb)
    await page.getByRole('link', { name: 'Payments release follow-up (synthetic)', exact: true }).click()
    await expect(page).toHaveURL(/\/meetings\/2$/)
    await page.goto(sb.url + '/')
    await page.getByRole('link', { name: 'Open Payments release follow-up (synthetic)' }).click()
    await expect(page).toHaveURL(/\/meetings\/2$/)
  })

  test('R01 review list groups change sets by state and opens one', async ({ page }) => {
    await signIn(page, sb, '/review')
    await expect(page.getByRole('heading', { name: /Needs your decision 1/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Ready to approve 1/ })).toBeVisible()
    await page.getByRole('link', { name: /Audio upload check/ }).click()
    await expect(page).toHaveURL(/\/review\/4$/)
  })
})

test.describe('empty database', () => {
  let sb: Sandbox
  test.beforeAll(async () => { sb = await startSandbox('empty', 'base-empty') })
  test.afterAll(async () => { await sb.stop() })

  test('E01 Overview shows an empty state with a way to add a meeting', async ({ page }) => {
    await signIn(page, sb)
    await expect(page.getByText(/No meetings yet/)).toBeVisible()
    await page.getByRole('link', { name: /Add your first meeting/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a meeting' })).toBeVisible()
  })

  test('E02 every page renders a sensible empty state without errors', async ({ page }) => {
    await signIn(page, sb)
    for (const [path, text] of [['/review', /No proposed changes yet/], ['/tasks', /No approved tasks yet/],
      ['/follow-up', /Approved tasks with a due date appear here/], ['/agenda', /Nothing is pending/], ['/memory', /Ask about owners/], ['/diagnostics', /Language model/]] as [string, RegExp][]) {
      await page.goto(sb.url + path)
      await expect(page.getByText(text).first()).toBeVisible()
    }
  })
})

test('R02 empty review list links to adding a meeting', async ({ page }) => {
  const sb = await startSandbox('empty', 'base-empty2')
  try {
    await signIn(page, sb, '/review')
    await page.getByRole('main').getByRole('link', { name: 'Add a meeting' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a meeting' })).toBeVisible()
  } finally { await sb.stop() }
})
