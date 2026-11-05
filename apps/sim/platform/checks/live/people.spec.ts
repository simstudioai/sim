import { expect, test } from '@playwright/test'
import { requireEnv, signIn } from '@/platform/checks/live/session'

/**
 * `PLATFORM_LIVE_EMAIL` is an administrator in an organization with the `people` flag on.
 * `PLATFORM_LIVE_NO_DIRECTORY_EMAIL` belongs to a permission group withholding
 * `organization.member_directory`.
 */
const password = () => requireEnv('PLATFORM_LIVE_PASSWORD')

test('the directory filters, pages and opens a profile that returns to the same view', async ({
  page,
}) => {
  await signIn(page, requireEnv('PLATFORM_LIVE_EMAIL'), password(), '/org/people')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Directory' }).check({ force: true })
  const table = page.getByRole('table', { name: 'People' })
  await expect(table.getByRole('row').nth(1)).toBeVisible()

  const email = requireEnv('PLATFORM_LIVE_EMAIL')
  await page.getByRole('searchbox', { name: 'Search people' }).fill(email)
  await expect(page).toHaveURL(/search=/)
  await table.getByRole('row').nth(1).getByRole('button').first().click()
  await expect(page).toHaveURL(/\/platform\/people\/[^/?]+\?.*search=/)
  await page.getByRole('link', { name: 'People' }).first().click()
  await expect(page).toHaveURL(/view=directory/)
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toHaveValue(email)
})

test('the chart reads without a canvas and an unknown focus says so', async ({ page }) => {
  await signIn(page, requireEnv('PLATFORM_LIVE_EMAIL'), password(), '/org/people?view=chart')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await expect(page.locator('.react-flow')).toHaveCount(0)
  await page.goto('/org/people?view=chart&focus=platform-live-missing')
  await expect(page.getByRole('heading', { name: 'Person unavailable' })).toBeVisible()
})

test('a member withheld the directory gets no People, from the sidebar or a saved link', async ({
  page,
}) => {
  await signIn(page, requireEnv('PLATFORM_LIVE_NO_DIRECTORY_EMAIL'), password(), '/org')
  await expect(page.getByRole('button', { name: 'Organization menu' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'People', exact: true })).toHaveCount(0)
  const response = await page.goto('/org/people')
  expect(response?.status()).toBe(404)
})
