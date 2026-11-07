import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('bulk access changes preserve an explicit administrator and discard hidden selections', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full`)
  const main = page.getByRole('main')
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Customer operations service account / })
    .click()
  await main.getByRole('tab', { name: 'Access', exact: true }).click()
  const people = main.getByRole('table', { name: 'People with access', exact: true })
  const alexRole = people.getByRole('combobox', { name: 'Role for Alex Chen', exact: true })
  await alexRole.click()
  await page.getByRole('option', { name: 'Admin', exact: true }).click()
  await people.getByRole('checkbox', { name: 'Select Nina Patel', exact: true }).check()
  await people.getByRole('checkbox', { name: 'Select Alex Chen', exact: true }).check()
  await expect(
    people.getByRole('checkbox', { name: 'Select all people with access', exact: true })
  ).toBeChecked()
  await expect(
    people.getByRole('checkbox', { name: 'Select Emir Karabeg', exact: true })
  ).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Remove selected', exact: true })).toBeDisabled()
  await main.getByRole('button', { name: 'Change role', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Member', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  const search = main.getByRole('searchbox', { name: 'Search people', exact: true })
  await search.fill('Alex')
  await expect(main.getByRole('button', { name: 'Remove selected', exact: true })).toHaveCount(0)
  await people.getByRole('checkbox', { name: 'Select Alex Chen', exact: true }).check()
  await main.getByRole('button', { name: 'Change role', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Member', exact: true }).click()
  await expect(alexRole).toContainText('Member')
  await search.fill('')
  await expect(
    people.getByRole('combobox', { name: 'Role for Nina Patel', exact: true })
  ).toContainText('Admin')
})
