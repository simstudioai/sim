import { expect, test } from '@playwright/test'
import {
  offEmail,
  offOrganizationId,
  organizationId,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import {
  expectHandoff,
  ROLLOUT_TEST_TIMEOUT_MS,
  waitForRollout,
} from '@/platform/checks/live/support/rollout'
import {
  expectMainAppSurface,
  expectPlatformSurface,
  recordZoneRequests,
} from '@/platform/checks/live/support/surfaces'

/**
 * One deployment, the zone built and running, and no global fallback: `PLATFORM_ORG_UI` is unset, and
 * the only way an organization reaches the Platform is its id in the AppConfig document. The first
 * test is what shows the document was read at all, since off is also what a failed read answers.
 */
test.setTimeout(ROLLOUT_TEST_TIMEOUT_MS)

test('a targeted organization is handed to the Platform', async ({ page }) => {
  const route = `/o/${organizationId()}/home`
  await signInAsAdmin(page, route)
  await waitForRollout(page, true)
  await expectHandoff(page, route, /\/org\/home/)
  await expectPlatformSurface(page)
})

test('an organization outside the rollout stays on /o, and /org is a 404 for it', async ({
  page,
}) => {
  const route = `/o/${offOrganizationId()}/home`
  await signIn(page, offEmail(), route)
  await waitForRollout(page, false)

  const zoneRequests = recordZoneRequests(page)
  const response = await page.goto(route)
  expect(response?.status()).toBe(200)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`))
  await expectMainAppSurface(page)
  expect(zoneRequests).toEqual([])

  for (const path of ['/org/home', '/org/settings/members']) {
    const zone = await page.goto(path)
    expect(zone?.status(), path).toBe(404)
    await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toHaveCount(0)
  }
})
