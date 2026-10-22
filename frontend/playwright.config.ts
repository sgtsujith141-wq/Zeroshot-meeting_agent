import { defineConfig } from '@playwright/test'

// Smoke tests drive the real UI served by the backend (default http://127.0.0.1:8000).
// E2E_TOKEN must be the organiser token of that server. PW_CHROMIUM_PATH can point
// at an already-installed Chromium if the bundled revision is not downloaded.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000',
    viewport: { width: 1360, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure',
  },
})
