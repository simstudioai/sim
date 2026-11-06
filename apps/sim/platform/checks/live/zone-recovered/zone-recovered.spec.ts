import { expect, test } from '@playwright/test'
import { organizationId, signInAsAdmin } from '@/platform/checks/live/session'
import { expectPlatformSurface } from '@/platform/checks/live/support/surfaces'

test('a zone that comes back takes its organizations back', async ({ page }) => {
  const route = `/o/${organizationId()}/home`
  await signInAsAdmin(page, route)
  await expect(async () => {
    await page.goto(route)
    await expect(page).toHaveURL(/\/org\/home/, { timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await expectPlatformSurface(page)
})
