import { expect, type Page, test } from '@playwright/test'
import { adminEmail, organizationId, signIn } from '@/platform/checks/live/session'

/**
 * Runs twice: built with no `SIM_PLATFORM_ORIGIN`, with the flag on; and built with the zone, with
 * the flag off. Neither may change anything for the organization.
 */
const LEGACY_ROUTES = ['home', 'settings/members', 'people'] as const

async function expectLegacySurface(page: Page, route: string) {
  const path = `/o/${organizationId()}/${route}`
  const response = await page.goto(path)
  expect(response?.status()).toBe(200)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?|$)`))
  await expect(page.locator('.workspace-root')).toBeVisible()
  await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
}

for (const route of LEGACY_ROUTES) {
  test(`/o/[id]/${route} renders the legacy surface with no redirect`, async ({ page }) => {
    await signIn(page, adminEmail(), `/o/${organizationId()}/${route}`)
    await expectLegacySurface(page, route)
  })
}

test('a client navigation stays on the legacy surface too', async ({ page }) => {
  await signIn(page, adminEmail(), `/o/${organizationId()}/home`)
  await page.getByRole('link', { name: 'People', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(`/o/${organizationId()}/people`))
  await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
})

test('/org is absent', async ({ page }) => {
  for (const path of ['/org', '/org/home', '/org/settings/members']) {
    await signIn(page, adminEmail(), `/o/${organizationId()}/home`)
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByRole('button', { name: 'Organization menu' })).toHaveCount(0)
  }
})
