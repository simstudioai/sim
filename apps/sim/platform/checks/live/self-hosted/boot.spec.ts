import { expect, test } from '@playwright/test'
import { signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'

/**
 * The image a self-hoster runs: on a hostname that is not Sim's, with billing and Enterprise off.
 * Every other live run is hosted Enterprise.
 */
test('a self-hosted deployment boots', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
})

test('a self-hosted organization is served the product surface', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const surfaceResponse = await page.request.get('/api/organizations/surface')
  expect(surfaceResponse.status()).toBe(200)
  const surface = (await surfaceResponse.json()) as {
    deployment: { hosted: boolean; billingEnabled: boolean }
  }
  expect(surface.deployment.hosted).toBe(false)
  expect(surface.deployment.billingEnabled).toBe(false)

  for (const route of ['/home', '/settings/members']) {
    const response = await page.goto(liveRoute(route))
    expect(response?.status(), route).toBe(200)
    await expect(page).toHaveURL(liveRoutePattern(route, '(?:\\?|$)'))
    await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toBeVisible()
  }
})
