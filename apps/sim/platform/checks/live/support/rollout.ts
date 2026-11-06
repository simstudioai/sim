import { type APIRequestContext, expect, type Page } from '@playwright/test'
import { requireEnv } from '@/platform/checks/live/session'

/**
 * Longer than a poll of AppConfig, whose in-process answer holds for 30s and is served once more
 * while it refreshes, so a change reaches the app at some point in this window. Next bundles the
 * module into each route, so each holds its own answer on its own clock: a route agreeing says
 * nothing about another, and a page has to be read until it does.
 */
const ROLLOUT_PROPAGATION_MS = 100_000

/** A test that changes the rollout outlives the suite's default timeout by that window. */
export const ROLLOUT_TEST_TIMEOUT_MS = 2 * ROLLOUT_PROPAGATION_MS + 60_000

/** Publishes a new `platform-org-ui` document, as a rollout or a rollback does. */
export async function targetOrganizations(request: APIRequestContext, orgIds: readonly string[]) {
  const url = `${requireEnv('PLATFORM_LIVE_APPCONFIG_URL')}/__control/platform-org-ui`
  const response = await request.put(url, { data: { orgIds } })
  expect(response.status()).toBe(204)
}

/** Waits until the surface API answers `expected` for the signed-in viewer's organization. */
export async function waitForRollout(page: Page, expected: boolean) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/organizations/surface')
        const { platformOrgUi } = (await response.json()) as { platformOrgUi: boolean }
        return platformOrgUi
      },
      { timeout: ROLLOUT_PROPAGATION_MS, intervals: [5_000] }
    )
    .toBe(expected)
}

/** Opens `route` until this page's own read of the rollout hands it to the Platform. */
export async function expectHandoff(page: Page, route: string, destination: RegExp) {
  await expect(async () => {
    await page.goto(route)
    await expect(page).toHaveURL(destination, { timeout: 2_000 })
  }).toPass({ timeout: ROLLOUT_PROPAGATION_MS })
}
