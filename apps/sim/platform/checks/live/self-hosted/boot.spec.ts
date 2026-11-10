import { expect } from '@playwright/test'
import { signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

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

  for (const [route, title] of [
    ['/home', /\S/],
    ['/settings/members', 'Members'],
  ] as const) {
    const response = await page.goto(liveRoute(route))
    expect(response?.status(), route).toBe(200)
    await expect(page).toHaveURL(liveRoutePattern(route, '(?:\\?|$)'))
    await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toBeVisible()
    // The section's own heading, so a shell around a missing page does not pass.
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: title }),
      route
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' }), route).toHaveCount(0)
  }
})
