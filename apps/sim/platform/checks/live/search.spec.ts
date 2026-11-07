import { expect, test } from '@playwright/test'
import { signInAsAdmin } from '@/platform/checks/live/session'

test('A query lands in the URL, searches under the viewer, and a filter narrows it', async ({
  page,
}) => {
  await signInAsAdmin(page, '/org/search')

  const searched = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/knowledge/search')
  )
  const field = page.getByRole('textbox', { name: 'Search' })
  await field.fill('onboarding')
  await field.press('Enter')
  await expect(page).toHaveURL(/q=onboarding/)
  expect((await searched).postDataJSON().query).toBe('onboarding')

  const filters = page.getByRole('group', { name: 'Search filters' })
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: /^Filter by date:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Past week' }).click()
  await expect(page).toHaveURL(/updated=7d/)

  await page.reload()
  await expect(field).toHaveValue('onboarding')
})

test('Home’s Search segment opens Search with the query', async ({ page }) => {
  await signInAsAdmin(page, '/org/home')
  await page.getByRole('radio', { name: 'Search' }).click()
  await page.getByRole('textbox', { name: /Search your company/ }).fill('renewal')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(/\/org\/search\?.*q=renewal/)
})
