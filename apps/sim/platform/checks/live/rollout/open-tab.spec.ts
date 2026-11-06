import { expect, test } from '@playwright/test'
import { organizationId, signInAsAdmin } from '@/platform/checks/live/session'
import {
  ROLLOUT_TEST_TIMEOUT_MS,
  targetOrganizations,
  waitForRollout,
} from '@/platform/checks/live/support/rollout'
import {
  expectMainAppSurface,
  expectPlatformSurface,
} from '@/platform/checks/live/support/surfaces'

/**
 * A rollback while someone has the Platform open. The shell's layout holds the rollout gate and does
 * not re-render on a client navigation, so an open tab keeps working until a full load, and a full
 * load is a 404 whose way out has to lead off the zone.
 */
test.setTimeout(ROLLOUT_TEST_TIMEOUT_MS)

test.afterEach(async ({ request }) => {
  await targetOrganizations(request, [organizationId()])
})

test('a rollback under an open tab keeps it working, and a reload finds the way back', async ({
  page,
  request,
}) => {
  const uncaught: string[] = []
  page.on('pageerror', (error) => uncaught.push(error.message))
  await signInAsAdmin(page, `/o/${organizationId()}/home`)
  await waitForRollout(page, true)
  await page.goto('/org/home')
  await expectPlatformSurface(page)

  await targetOrganizations(request, [])
  await waitForRollout(page, false)

  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await nav.getByRole('link', { name: 'People', exact: true }).click()
  await expect(page).toHaveURL(/\/org\/people/)
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await expectPlatformSurface(page)
  expect(uncaught).toEqual([])

  const reloaded = await page.reload()
  expect(reloaded?.status()).toBe(404)
  await expect(page.getByText('Page not found')).toBeVisible()

  await page.getByRole('button', { name: 'Return home' }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${organizationId()}(?:/|\\?|$)`))
  await expectMainAppSurface(page)
  expect(uncaught).toEqual([])
})
