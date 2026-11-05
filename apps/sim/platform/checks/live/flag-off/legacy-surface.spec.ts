import { expect, type Page, test } from '@playwright/test'
import { organizationId, signInAsAdmin } from '@/platform/checks/live/session'

/**
 * Runs twice: built with no `SIM_PLATFORM_ORIGIN`, with the flag on; and built with the zone, with
 * the flag off. Neither may change anything for the organization: the main app serves `/o/[id]`
 * itself, with the design-system views it embeds, and nothing is ever asked of the zone. So this
 * tells the two apart by the zone's own traces, not by the design system's `[data-platform-ui]`,
 * which the embedded rail and pages legitimately carry.
 */
const LEGACY_ROUTES = ['home', 'settings/members', 'people'] as const

function isZoneRequest(url: string) {
  const { pathname } = new URL(url)
  return pathname === '/org' || pathname.startsWith('/org/')
}

/** Every request this page makes to the zone from now on, documents and assets alike. */
function recordZoneRequests(page: Page) {
  const zoneRequests: string[] = []
  page.on('request', (request) => {
    if (isZoneRequest(request.url())) zoneRequests.push(request.url())
  })
  return zoneRequests
}

async function expectMainAppSurface(page: Page) {
  await expect(page.locator('.workspace-root')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Organization sidebar' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toHaveCount(0)
}

for (const route of LEGACY_ROUTES) {
  test(`/o/[id]/${route} stays on the main app with no redirect`, async ({ page }) => {
    const path = `/o/${organizationId()}/${route}`
    await signInAsAdmin(page, path)
    const zoneRequests = recordZoneRequests(page)
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    expect(response?.request().redirectedFrom()).toBeNull()
    await expect(page).toHaveURL(new RegExp(`${path}(?:\\?|$)`))
    await expectMainAppSurface(page)
    expect(zoneRequests).toEqual([])
  })
}

test('a client navigation stays on the main app too', async ({ page }) => {
  await signInAsAdmin(page, `/o/${organizationId()}/home`)
  const zoneRequests = recordZoneRequests(page)
  await page.getByRole('link', { name: 'People', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(`/o/${organizationId()}/people`))
  await expectMainAppSurface(page)
  expect(zoneRequests).toEqual([])
})

test('/org is absent', async ({ page }) => {
  await signInAsAdmin(page, `/o/${organizationId()}/home`)
  for (const path of ['/org', '/org/home', '/org/settings/members']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByRole('button', { name: 'Organization menu' })).toHaveCount(0)
  }
})
