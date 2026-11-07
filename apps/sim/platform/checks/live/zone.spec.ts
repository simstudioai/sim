import { expect, test } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import {
  adminEmail,
  organizationId,
  signInAsAdmin,
  signInThroughForm,
} from '@/platform/checks/live/session'

/** A legacy page the Platform has no counterpart for, and one every administrator can open. */
const UNMAPPED = '/settings/integrations'

const legacy = (path: string) => `/o/${organizationId()}${path}`

const REDIRECTS: readonly (readonly [string, string])[] = [
  ['', '/org/home'],
  ['/home', '/org/home'],
  ['/people', '/org/people'],
  ['/settings', '/org/settings'],
  ['/settings/members', '/org/settings/members'],
  ['/settings/team', '/org/settings/members'],
  ['/settings/subscription?from=mail', '/org/settings/billing?from=mail'],
  ['/settings/general?view=privacy', '/org/settings/general?view=privacy'],
  ['/links?search=hand', '/org/settings/links?search=hand'],
  ['/search?q=renewal', '/org/search?q=renewal'],
]

for (const [from, to] of REDIRECTS) {
  test(`legacy /o/[id]${from} lands on ${to}`, async ({ page }) => {
    await signInAsAdmin(page, legacy(from))
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(to)}$`))
    await expect(page.locator('[data-platform-ui]').first()).toBeVisible()
  })
}

test('the component workbench is not served by a live zone', async ({ page }) => {
  const response = await page.goto('/org/workbench?recipe=C1084')
  expect(response?.status()).toBe(404)
})

test('a Slack handoff link stays on the legacy integrations page', async ({ page }) => {
  await signInAsAdmin(page, '/org/home')
  const target = legacy('/integrations?slack=not-a-token')
  await page.goto(target)
  await expect(page).not.toHaveURL(/\/org\//)
})

test('a route with no Platform counterpart stays legacy', async ({ page }) => {
  await signInAsAdmin(page, legacy(UNMAPPED))
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(legacy(UNMAPPED))}$`))
  // The main app serves it, embedded rail and all, rather than this zone's shell.
  await expect(page.getByRole('complementary', { name: 'Organization sidebar' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toHaveCount(0)
})

test('a client navigation into a mapped legacy route also reaches the Platform', async ({
  page,
}) => {
  await signInAsAdmin(page, legacy(UNMAPPED))
  await page.getByRole('link', { name: 'Members', exact: true }).first().click()
  await expect(page).toHaveURL(/\/org\/settings\/members/)
})

test('signing in from a Platform link returns to the zone', async ({ page }) => {
  await page.goto('/org/settings/members?search=rae')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=/)
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/org')
  await signInThroughForm(page, adminEmail(), '/org/settings/members?search=rae')
  await expect(page).toHaveURL(/\/org\/home/)
})

test('zone pages carry the security headers and load their assets under the base path', async ({
  page,
}) => {
  await signInAsAdmin(page, '/org/home')
  const response = await page.goto('/org/home')
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toBeTruthy()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  const assets = await page.evaluate(() =>
    [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(
      (node) => node.getAttribute('src') ?? node.getAttribute('href') ?? ''
    )
  )
  const local = assets.filter((asset) => asset.includes('/_next/'))
  expect(local.length).toBeGreaterThan(0)
  for (const asset of local) {
    expect(new URL(asset, page.url()).pathname).toMatch(/^\/org\/_next\//)
  }
})

test('a forged legacy URL header cannot move a viewer anywhere the proxy did not say', async ({
  page,
}) => {
  await signInAsAdmin(page, legacy(UNMAPPED))
  await page.setExtraHTTPHeaders({ 'x-sim-legacy-url': legacy('/home') })
  await page.goto(legacy(UNMAPPED))
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(legacy(UNMAPPED))}$`))
})
