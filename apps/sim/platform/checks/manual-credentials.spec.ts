import { expect } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test('credential Back returns to its directory origin with filters intact', async ({ page }) => {
  await page.goto(fixtureUrl('/integrations?state=full&tab=credentials&q=Customer&order=desc'))
  const main = page.getByRole('main')
  await main.getByRole('link', { name: /^Customer operations service account / }).click()
  await expect(main.getByLabel('Credential ID', { exact: true })).toBeVisible()
  await expect(
    main.getByRole('navigation', { name: 'Credentials navigation', exact: true }).getByRole('link')
  ).toBeVisible()
  await main
    .getByRole('navigation', { name: 'Credentials navigation', exact: true })
    .getByRole('link')
    .click()
  await expect(main.getByRole('searchbox', { name: 'Search credentials' })).toHaveValue('Customer')
  await expect(page).toHaveURL(/tab=credentials/)
  await expect(page).toHaveURL(/order=desc/)
  await page.goBack()
  await expect(main.getByLabel('Credential ID', { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    main.getByRole('navigation', { name: 'Credentials navigation', exact: true }).getByRole('link')
  ).toBeVisible()
})

test('manual secrets link to apps, start private and clear values across type changes and reopening', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  await page.goto(fixtureUrl('/integrations/onepassword?state=full'))
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Create credential', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Create credential', exact: true })
  await modal.getByLabel('Name', { exact: true }).fill('Operations vault')
  await modal.getByLabel('Key', { exact: true }).fill('VAULT_TOKEN')
  await modal.getByLabel('Value', { exact: true }).fill('discard-this-secret')
  await modal.getByRole('combobox', { name: 'Type', exact: true }).click()
  await page.getByRole('option', { name: 'API key', exact: true }).click()
  await expect(modal.getByLabel('Value', { exact: true })).toHaveValue('')
  await modal.getByLabel('Value', { exact: true }).fill('another-discarded-secret')
  await modal.getByRole('combobox', { name: 'Type', exact: true }).click()
  await page.getByRole('option', { name: 'Service account JSON', exact: true }).click()
  await expect(modal.getByLabel('JSON key', { exact: true })).toHaveValue('')
  await modal.getByLabel('JSON key', { exact: true }).fill('[]')
  await modal.getByRole('button', { name: 'Create credential', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('non-empty object')
  await modal.getByRole('combobox', { name: 'Type', exact: true }).click()
  await page.getByRole('option', { name: 'Refresh token', exact: true }).click()
  await expect(modal.getByLabel('Value', { exact: true })).toHaveValue('')
  await modal.getByLabel('Value', { exact: true }).fill('manual-refresh-token-never-retained')
  await modal.getByRole('button', { name: 'Create credential', exact: true }).click()
  await main.getByRole('button', { name: /^Operations vault / }).click()
  const id = await main.getByLabel('Credential ID', { exact: true }).inputValue()
  await main.getByRole('tab', { name: 'Access', exact: true }).click()
  const table = main.getByRole('table', { name: 'People with access', exact: true })
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(
    table.getByRole('button', { name: 'Role for Emir Karabeg: Admin', exact: true })
  ).toBeDisabled()
  await main.getByRole('combobox', { name: 'People', exact: true }).click()
  await page.getByRole('option', { name: 'Nina Patel', exact: true }).click()
  await page.keyboard.press('Escape')
  await main.getByRole('button', { name: 'Add people', exact: true }).click()
  await expect(table.getByRole('row', { name: /Nina Patel/ })).toBeVisible()
  await main
    .getByRole('navigation', { name: '1Password navigation', exact: true })
    .getByRole('link', { name: '1Password', exact: true })
    .click()
  await expect(main.getByRole('button', { name: /^Operations vault / })).toBeVisible()
  await expect(main.getByText(/^Used by /)).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(main.getByRole('link', { name: /^1Password / })).toContainText(
    '1 connected credential'
  )
  await main.getByRole('link', { name: 'Credentials', exact: true }).click()
  await expect(main.getByRole('link', { name: /^emir@sim.ai / })).toHaveCount(0)
  await main
    .getByRole('region', { name: 'Shared', exact: true })
    .getByRole('button', { name: /^Operations vault / })
    .click()
  await expect(main.getByLabel('Credential ID', { exact: true })).toHaveValue(id)
  await main.getByRole('button', { name: 'Replace value', exact: true }).click()
  const replacement = page.getByRole('dialog', { name: 'Replace Operations vault', exact: true })
  await expect(replacement.getByLabel('Replace value', { exact: true })).toHaveValue('')
  await replacement.getByLabel('Replace value', { exact: true }).fill('cancelled-replacement-token')
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main.getByRole('button', { name: 'Replace value', exact: true }).click()
  await expect(replacement.getByLabel('Replace value', { exact: true })).toHaveValue('')
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main.getByRole('tab', { name: 'Access', exact: true }).click()
  await main.getByRole('searchbox', { name: 'Search people', exact: true }).fill('Nina')
  await main
    .getByRole('navigation', { name: 'Credentials navigation', exact: true })
    .getByRole('link')
    .click()
  await expect(page).not.toHaveURL(/credentialTab=|accessQ=/)
  await main.getByRole('button', { name: /^Research API / }).click()
  await expect(main.getByLabel('Credential ID', { exact: true })).toHaveValue('research-api-key')
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  ).not.toMatch(
    /discard-this-secret|manual-refresh-token-never-retained|cancelled-replacement-token/
  )
  expect(writes).toEqual([])
})
