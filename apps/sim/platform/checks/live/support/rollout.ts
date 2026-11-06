import { type APIRequestContext, expect, type Page } from '@playwright/test'
import { requireEnv } from '@/platform/checks/live/session'

/**
 * Longer than a poll of AppConfig, whose in-process answer holds for 30s and is served once more
 * while it refreshes, so a change reaches the app at some point in this window.
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

/** Waits until the main app answers `expected` for the signed-in viewer's organization. */
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
