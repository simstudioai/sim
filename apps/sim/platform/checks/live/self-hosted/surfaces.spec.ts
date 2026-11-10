import { expect } from '@playwright/test'
import { SIM_SITE_URL } from '@sim/utils/site'
import { signInAsAdmin } from '@/platform/checks/live/session'
import { firstHopFrom } from '@/platform/checks/live/support/navigation'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * The product surface as a self-hoster gets it: billing off, so no section sells or bills, and
 * everything else the hosted suite walks still renders, redirects and answers in the same shell.
 */
const WORKSPACE_ID = 'platform-live-workspace-main'
const WORKSPACE = `/workspace/${WORKSPACE_ID}`

test('a self-hosted shell renders every section a member uses', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  for (const route of [
    '/home',
    '/search',
    '/chat',
    '/integrations',
    '/settings',
    '/settings/members',
    '/settings/links',
  ]) {
    const response = await page.goto(liveRoute(route))
    expect(response?.status(), route).toBe(200)
    await expect(page, route).toHaveURL(liveRoutePattern(route, '(?:\\?|$)'))
    await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' }), route).toHaveCount(0)
  }
})

test('self-hosted settings offer no billing section, a saved billing link is not found, and plans go to the hosted app', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/settings'))
  await expect(page.getByRole('link', { name: 'Billing', exact: true })).toHaveCount(0)
  await page.goto(liveRoute('/settings/billing'))
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  // A self-hosted deployment buys its plan on the hosted app, as the legacy upgrade page sent it.
  await page.route(`${SIM_SITE_URL}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: 'Hosted upgrade stand-in' })
  )
  await page.goto(liveRoute('/settings/billing/plans?reason=credits'))
  await expect(page).toHaveURL(`${SIM_SITE_URL}/upgrade?reason=credits`)
})

for (const [from, to] of [
  [`${WORKSPACE}/home`, liveRoute('/home')],
  [`${WORKSPACE}/settings/apikeys?from=mail`, `${WORKSPACE}/settings/api-keys?from=mail`],
  [
    `${WORKSPACE}/integrations?oauth=connected`,
    liveRoute(`/integrations?oauth=connected&workspace=${WORKSPACE_ID}`),
  ],
] as const) {
  test(`self-hosted, a saved ${from} reaches ${to} in one hop`, async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    expect(await firstHopFrom(page, from)).toBe(to)
  })
}

test('a self-hosted chat turn reaches the worker and its reply streams back', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.getByRole('textbox', { name: /Ask about your business/ }).fill('Say hello')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(liveRoutePattern('/chat'))
  await expect(page.getByText('Hello from the scripted agent.')).toBeVisible({ timeout: 30_000 })
})
