import { expect, test } from '@playwright/test'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use a real seeded member`)
  return value
}

test('A query lands in the URL, searches under the viewer, and a filter narrows it', async ({
  page,
}) => {
  await page.goto('/platform/search')
  await page.locator('#email').fill(requireEnv('PLATFORM_LIVE_EMAIL'))
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/platform/)
  await page.goto('/platform/search')

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
  await filters.getByRole('combobox', { name: 'Filter by date' }).click()
  await page.getByRole('option', { name: 'Past week' }).click()
  await expect(page).toHaveURL(/updated=7d/)

  await page.reload()
  await expect(field).toHaveValue('onboarding')
})

test('Home’s Search segment opens Search with the query', async ({ page }) => {
  await page.goto('/platform/home')
  await page.locator('#email').fill(requireEnv('PLATFORM_LIVE_EMAIL'))
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/platform\/home/)
  await page.getByRole('radio', { name: 'Search' }).click()
  await page.getByRole('textbox', { name: /Search your company/ }).fill('renewal')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(/\/platform\/search\?.*q=renewal/)
})
