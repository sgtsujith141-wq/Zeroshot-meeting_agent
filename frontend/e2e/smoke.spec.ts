import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? ''
const SHOTS = process.env.SHOT_DIR

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Organiser token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Meetings' })).toBeVisible()
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

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
  await shot(page, '01-inbox')
  for (const [link, heading, name] of [
    ['Review changes', 'Review changes', '02-review-list'], ['Task board', 'Task board', '03-tasks'],
    ['Calendar & reminders', 'Calendar and reminders', '04-follow-up'], ['Next agenda', 'Next meeting agenda', '05-agenda'],
    ['Ask past meetings', 'Ask past meetings', '06-memory'], ['Diagnostics', 'Diagnostics', '07-diagnostics'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await shot(page, name)
  }
  expect(errors).toEqual([])
})

test('new meeting form enforces consent before upload', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Add a meeting' }).click()
  await expect(page.getByText('Recording or transcribing people without their agreement is not allowed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload and process' })).toBeDisabled()
  await shot(page, '08-new-meeting')
})

test('phone width: no horizontal page overflow on the main views', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  for (const path of ['/', '/review', '/review/2', '/tasks', '/follow-up', '/agenda', '/memory', '/diagnostics', '/meetings/1']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
  }
  await page.goto('/review/2')
  await page.waitForLoadState('networkidle')
  await shot(page, '09-mobile-review')
})
