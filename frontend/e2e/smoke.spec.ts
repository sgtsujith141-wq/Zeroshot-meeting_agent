// Read-only smoke tests against a running server: E2E_BASE_URL (default http://127.0.0.1:8000)
// with E2E_TOKEN. They never write data, so they are safe against the demo server.
import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = process.env.SHOT_DIR

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Organiser token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible()
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

test.beforeEach(() => { test.skip(!TOKEN, 'E2E_TOKEN not set') })

test('rejects a wrong token', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Organiser token').fill('definitely-wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('invalid organiser token')
})

test('every main view loads from the live API without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await signIn(page)
  await shot(page, '01-overview')
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const [link, heading, name] of [
    ['Meetings', 'Meetings', '02-meetings'], ['Approvals', 'Approvals', '03-approvals'], ['Tasks', 'Tasks', '04-tasks'],
    ['Ask AI', 'Ask AI', '05-ask'], ['Follow-ups', 'Follow-ups', '06-follow-ups'],
  ]) {
    await nav.getByRole('link', { name: new RegExp(`^${link}`) }).click()
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await shot(page, name)
  }
  await page.getByRole('complementary').getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Diagnostics' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('new meeting form enforces consent before upload', async ({ page }) => {
  await signIn(page)
  await page.getByRole('main').getByRole('link', { name: 'New meeting' }).click()
  await expect(page.getByText('Recording or transcribing people without their agreement is not allowed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload and process' })).toBeDisabled()
  await shot(page, '07-new-meeting')
})

test('phone width: no horizontal page overflow on the main views', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  for (const path of ['/', '/meetings', '/approvals', '/approvals/2', '/tasks', '/tasks?view=board', '/ask', '/follow-ups', '/follow-ups?tab=reminders', '/diagnostics', '/meetings/1']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
  }
})
