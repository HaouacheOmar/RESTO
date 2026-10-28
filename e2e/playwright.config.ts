import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys across the real role spaces. By default against the Docker stack (`docker compose up`,
 * http://localhost:8088); BASE_URL points them at any other environment (a staging deployment).
 * They create their own data (a new client account, orders), so never point them at production.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,  // the journeys share the demo staff (one driver, one cashier…)
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8088',
    locale: 'fr-FR',
    timezoneId: 'Africa/Algiers',  // the restaurant's time zone, as on the server
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
