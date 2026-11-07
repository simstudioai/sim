import { expect, test } from '@playwright/test'
import {
  memberEmail,
  organizationId,
  signInAsAdmin,
  signInThroughForm,
} from '@/platform/checks/live/session'
import { expectMainAppSurface, recordZoneRequests } from '@/platform/checks/live/support/surfaces'

/**
 * Runs twice with the flag on and the build's `/org` rewrite in place: once with the zone's process
 * gone, and once with a zone answering 503 to everything. Without the proxy's availability check
 * either would strand the organization: `/o` redirects to `/org`, and Next answers a rewrite it
 * cannot complete with a bare 500, so there would be no way back to a surface that still works.
 */
const organizationRoute = (route: string) => `/o/${organizationId()}/${route}`
const onTheOrganizationSurface = () => new RegExp(`/o/${organizationId()}(?:/|\\?|$)`)

test.beforeEach(async ({ request }) => {
  // The phase starts the moment the zone goes away, and the app holds its last verdict for seconds.
  await expect
    .poll(async () => (await request.get('/org/home', { maxRedirects: 0 })).status(), {
      timeout: 30_000,
    })
    .toBe(307)
})

test('with the zone unavailable, a legacy URL renders on the main app with no handoff', async ({
  page,
}) => {
  const route = organizationRoute('settings/members')
  await signInAsAdmin(page, route)
  const zoneRequests = recordZoneRequests(page)
  const response = await page.goto(route)
  expect(response?.status()).toBe(200)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`))
  await expectMainAppSurface(page)
  expect(zoneRequests).toEqual([])
})

test('with the zone unavailable, a client navigation on the main app stays there', async ({
  page,
}) => {
  await signInAsAdmin(page, organizationRoute('home'))
  const zoneRequests = recordZoneRequests(page)
  await page.goto(organizationRoute('home'))
  await page.getByRole('link', { name: 'People', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(organizationRoute('people')))
  await expectMainAppSurface(page)
  expect(zoneRequests).toEqual([])
})

test('with the zone unavailable, a Platform page returns to the main app', async ({ page }) => {
  await signInAsAdmin(page, organizationRoute('home'))
  const response = await page.goto('/org/settings/members?search=rae')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(onTheOrganizationSurface())
  await expectMainAppSurface(page)
})

test('with the zone unavailable, an open tab’s client navigation is sent back too', async ({
  page,
}) => {
  await signInAsAdmin(page, organizationRoute('home'))
  const flight = await page.request.get('/org/people', {
    headers: { RSC: '1' },
    maxRedirects: 0,
  })
  expect(flight.status()).toBe(307)
  expect(new URL(flight.headers().location ?? '', page.url()).pathname).toBe('/o')
})

test('with the zone unavailable, signing in from a Platform link reaches the main app', async ({
  page,
}) => {
  await signInThroughForm(page, memberEmail(), '/org/home')
  await expect(page).toHaveURL(onTheOrganizationSurface())
  await expectMainAppSurface(page)
})
