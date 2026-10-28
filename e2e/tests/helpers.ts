import { expect, type Browser, type Page } from '@playwright/test'

export const PASSWORD = 'demo-resto-2026'  // the demo staff accounts (seed_demo)

/** A fresh browser session signed in as one demo account, on its space. */
export async function signedIn(browser: Browser, username: string, password = PASSWORD): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/connexion')
  await page.getByLabel('Nom d’utilisateur').fill(username)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace\//)
  return page
}

/** The manager dashboard shows the WebSocket state: wait until it is connected. */
export async function live(page: Page) {
  await expect(page.getByText('Connecté', { exact: true })).toBeVisible()
}

/** Tomorrow in the restaurant's time zone, as YYYY-MM-DD. */
export function tomorrow() {
  const day = new Date(Date.now() + 24 * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(day)
}

export const uid = () => Date.now().toString(36)
