import { expect, test } from '@playwright/test'
import { organizationId, signInAsAdmin } from '@/platform/checks/live/session'
import { expectMainAppSurface, recordZoneRequests } from '@/platform/checks/live/support/surfaces'

/**
 * The image a self-hoster runs: no `SIM_PLATFORM_ORIGIN`, so no zone and no rewrite, on a hostname
 * that is not Sim's, with billing off and no rollout flag. Every other live run is hosted Enterprise.
 */
test('a self-hosted deployment with no zone boots', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
})

test('a self-hosted organization is served by the main app', async ({ page }) => {
  const home = `/o/${organizationId()}/home`
  await signInAsAdmin(page, home)
  const surfaceResponse = await page.request.get('/api/organizations/surface')
  expect(surfaceResponse.status()).toBe(200)
  const surface = (await surfaceResponse.json()) as {
    platformOrgUi: boolean
    deployment: { hosted: boolean; billingEnabled: boolean }
  }
  expect(surface.platformOrgUi).toBe(false)
  expect(surface.deployment.hosted).toBe(false)
  expect(surface.deployment.billingEnabled).toBe(false)

  const zoneRequests = recordZoneRequests(page)
  for (const route of [home, `/o/${organizationId()}/settings/members`]) {
    const response = await page.goto(route)
    expect(response?.status(), route).toBe(200)
    expect(response?.request().redirectedFrom(), route).toBeNull()
    await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`))
    await expectMainAppSurface(page)
  }
  expect(zoneRequests).toEqual([])
})

test('a self-hosted deployment has no /org', async ({ page }) => {
  await signInAsAdmin(page, `/o/${organizationId()}/home`)
  for (const path of ['/org', '/org/home']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
  }
})
