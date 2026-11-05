import { expect, type Page, test } from '@playwright/test'
import { adminEmail, organizationId, signIn } from '@/platform/checks/live/session'

/**
 * `PLATFORM_LIVE_ZONE=1` means the app was built with `SIM_PLATFORM_ORIGIN` and is running with the
 * flag off; unset, there is no zone at all, even with the flag on.
 */
const zoneBuilt = process.env.PLATFORM_LIVE_ZONE === '1'

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

test('with no zone built, /platform is absent', async ({ page }) => {
  test.skip(zoneBuilt, 'This build has a zone; its /platform is exercised by the zone project')
  for (const path of ['/platform', '/platform/home', '/platform/settings/members']) {
    await signIn(page, adminEmail(), `/o/${organizationId()}/home`)
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
  }
})
