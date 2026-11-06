import { expect, type Page } from '@playwright/test'

function isZoneRequest(url: string) {
  const { pathname } = new URL(url)
  return pathname === '/org' || pathname.startsWith('/org/')
}

/** Every request this page makes to the zone from now on, documents and assets alike. */
export function recordZoneRequests(page: Page) {
  const zoneRequests: string[] = []
  page.on('request', (request) => {
    if (isZoneRequest(request.url())) zoneRequests.push(request.url())
  })
  return zoneRequests
}

/**
 * The main app serving `/o` itself. Told apart by the zone's own traces, not by the design system's
 * `[data-platform-ui]`, which the embedded rail and pages legitimately carry.
 */
export async function expectMainAppSurface(page: Page) {
  await expect(page.locator('.workspace-root')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Organization sidebar' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toHaveCount(0)
}

export async function expectPlatformSurface(page: Page) {
  await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Organization sidebar' })).toHaveCount(0)
}
