import { expect, test } from '@playwright/test'

import { signedIn, tomorrow, uid } from './helpers'

test('a booking goes from the client to the receipt, each screen updating live', async ({ browser }) => {
  const id = uid()
  const name = `E2E ${id}`

  // The desk and the till are already open: what happens next must reach them without a reload.
  const desk = await signedIn(browser, 'reservations')
  await desk.goto('/espace/reservations?onglet=a-valider')
  const till = await signedIn(browser, 'cashier')

  // A new client signs up and books a table for tomorrow.
  const client = await (await browser.newContext()).newPage()
  await client.goto('/inscription')
  await client.getByLabel('Prénom').fill('E2E')
  await client.getByLabel('Nom', { exact: true }).fill(id)
  await client.getByLabel('Nom d’utilisateur').fill(`e2e_${id}`)
  await client.getByLabel('E-mail').fill(`e2e_${id}@example.com`)
  await client.getByLabel('Mot de passe').fill('Resto-e2e-2026')
  await client.getByRole('button', { name: 'Créer mon espace' }).click()
  await expect(client).toHaveURL(/\/espace\/client/)
  await client.getByLabel('Date').fill(tomorrow())
  await client.getByLabel('Nombre de personnes').fill('2')
  await client.getByRole('button', { name: 'Demander cette table' }).click()
  await expect(client.getByRole('heading', { name: /Table n°\d+ proposée/ })).toBeVisible()

  // The desk sees it arrive, confirms it, then seats the guests at a free table.
  const card = desk.locator('.desk-card', { hasText: name })
  await card.getByRole('button', { name: 'Confirmer' }).click()
  await desk.getByRole('tab', { name: /À venir/ }).click()
  await card.getByRole('button', { name: 'Check-in' }).click()
  const table = card.locator('.table-picker label').first()
  const number = (await table.locator('strong').innerText()).replace('n°', '')
  await table.click()
  await card.getByRole('button', { name: 'Installer' }).click()
  await expect(card).toHaveCount(0)  // seated: no longer waiting

  // The waiter orders two teas for that table and sends them to the till.
  const floor = await signedIn(browser, 'waiter')
  await floor.locator('.table-tile', { hasText: name }).click()
  const add = floor.getByRole('button', { name: 'Ajouter un Thé à la menthe' })
  await add.click()
  await add.click()
  await floor.getByRole('button', { name: 'Envoyer en caisse' }).click()

  // The open till shows the bill, the cashier is paid by card and the receipt comes up.
  const bill = till.locator('.till-card', { hasText: name })
  await expect(bill).toContainText('2 × Thé à la menthe')
  await expect(bill).toContainText(`Table n°${number}`)
  await bill.getByRole('button', { name: 'Encaisser' }).click()
  await bill.getByText('Carte', { exact: true }).click()
  await bill.getByRole('button', { name: /^Encaisser \d/ }).click()
  const receipt = till.getByRole('dialog')
  await expect(receipt).toContainText('RESTO')
  await expect(receipt).toContainText('Thé à la menthe')
  await expect(receipt).toContainText(/carte/i)
})
