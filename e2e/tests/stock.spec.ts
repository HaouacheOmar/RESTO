import { expect, test } from '@playwright/test'

import { live, signedIn } from './helpers'

test('a rupture takes its dishes off the Menu and reaches the manager live', async ({ browser }) => {
  const manager = await signedIn(browser, 'manager')
  await live(manager)

  const stock = await signedIn(browser, 'stock')
  const mint = stock.locator('.stock-row', { has: stock.getByRole('heading', { name: 'Menthe', exact: true }) })
  await mint.getByRole('button', { name: 'Rupture…' }).click()
  await expect(mint).toContainText('Thé à la menthe')  // the confirmation lists what leaves the Menu
  await mint.getByRole('button', { name: 'Déclarer la rupture' }).click()

  await expect(manager.getByText('Rupture : Menthe')).toBeVisible()
  const menu = await (await browser.newContext()).newPage()
  await menu.goto('/')
  await expect(menu.getByText('Les classiques de la maison')).toBeVisible()
  await expect(menu.getByText('Thé à la menthe')).toHaveCount(0)

  // End of the rupture: the tea is back.
  await stock.locator('.stock-row', { has: stock.getByRole('heading', { name: 'Menthe', exact: true }) })
    .getByRole('button', { name: 'Fin de rupture' }).click()
  await expect(manager.getByText('Fin de rupture : Menthe')).toBeVisible()
  await menu.reload()
  await expect(menu.getByText('Thé à la menthe').first()).toBeVisible()
})
