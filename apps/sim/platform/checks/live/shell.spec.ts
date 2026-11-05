import { expect, test } from '@playwright/test'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use a real seeded member`)
  return value
}

test('signing in through the zone lands on a shell showing the real organization', async ({
  page,
}) => {
  const email = requireEnv('PLATFORM_LIVE_EMAIL')
  const password = requireEnv('PLATFORM_LIVE_PASSWORD')
  const organization = requireEnv('PLATFORM_LIVE_ORGANIZATION_NAME')

  await page.goto('/platform')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=%2Fplatform/)

  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page).toHaveURL(/\/platform(?:\/|$)/)
  await expect(page.getByRole('button', { name: 'Organization menu' })).toContainText(organization)
})
