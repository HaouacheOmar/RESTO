import { expect, test } from '@playwright/test'

import { signedIn } from './helpers'

test('a delivery is ordered, assigned, delivered and paid to the driver', async ({ browser }) => {
  const driver = await signedIn(browser, 'driver')
  const start = driver.getByRole('button', { name: 'Commencer mon service' })
  if (await start.isVisible()) await start.click()
  await expect(driver.getByRole('status').filter({ hasText: /Disponible|En livraison/ })).toBeVisible()

  const desk = await signedIn(browser, 'reservations')
  await desk.goto('/espace/reservations?onglet=livraisons')

  // The client orders a delivery.
  const client = await signedIn(browser, 'client')
  await client.goto('/espace/client?onglet=commander')
  await client.getByRole('button', { name: 'Ajouter un Thé à la menthe' }).click()
  await client.getByLabel('Adresse de livraison').fill('12 rue des Tests, Alger')
  await client.getByRole('button', { name: 'Commander' }).click()
  const order = client.locator('.card').first()  // newest first
  await expect(order).toContainText('1 × Thé à la menthe')
  const number = (await order.getByRole('heading', { name: /Commande n°\d+/ }).innerText()).replace(/\D/g, '')

  // The open desk sees it and gives it to Karim, the demo driver.
  const choice = desk.getByLabel(`Livreur pour la commande n°${number}`)
  await choice.selectOption({ label: 'Karim' })
  await choice.locator('xpath=..').getByRole('button', { name: 'Attribuer' }).click()

  // His phone shows the delivery live; he hands it over and collects the cash.
  await expect(driver.getByText(`commande n°${number}`)).toBeVisible()
  await driver.getByRole('button', { name: 'Livrée et encaissée' }).click()
  await driver.getByRole('button', { name: /^Confirmer .* encaissés$/ }).click()
  await expect(driver.getByText('Aucune livraison en cours', { exact: false })).toBeVisible()

  // The client's order is marked delivered without a reload.
  await expect(client.locator('.card', { hasText: `Commande n°${number}` })).toContainText('Livrée')
})
