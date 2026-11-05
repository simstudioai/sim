import { expect, test } from '@playwright/test'
import {
  adminEmail,
  organizationId,
  signIn,
  signInThroughForm,
} from '@/platform/checks/live/session'

const legacy = (path: string) => `/o/${organizationId()}${path}`

const REDIRECTS: readonly (readonly [string, string])[] = [
  ['', '/org/home'],
  ['/home', '/org/home'],
  ['/people', '/org/people'],
  ['/settings', '/org/settings'],
  ['/settings/members', '/org/settings/members'],
  ['/settings/team', '/org/settings/members'],
  ['/settings/subscription?from=mail', '/org/settings/billing?from=mail'],
  ['/settings/general?view=privacy', '/org/settings/privacy'],
  ['/links?search=hand', '/org/settings/links?search=hand'],
  ['/search?q=renewal', '/org/search?q=renewal'],
]

for (const [from, to] of REDIRECTS) {
  test(`legacy /o/[id]${from} lands on ${to}`, async ({ page }) => {
    await signIn(page, adminEmail(), legacy(from))
    await page.goto(legacy(from))
    await expect(page).toHaveURL(new RegExp(`${to.replace(/[?]/g, '\\?')}$`))
    await expect(page.locator('[data-platform-ui]').first()).toBeVisible()
  })
}

test('a route with no Platform counterpart stays legacy', async ({ page }) => {
  await signIn(page, adminEmail(), legacy('/skills'))
  await page.goto(legacy('/skills'))
  await expect(page).toHaveURL(new RegExp(`${legacy('/skills')}$`))
  await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
})

test('a client navigation into a mapped legacy route also reaches the Platform', async ({
  page,
}) => {
  await signIn(page, adminEmail(), legacy('/skills'))
  await page.goto(legacy('/skills'))
  await page.getByRole('link', { name: 'People', exact: true }).first().click()
  await expect(page).toHaveURL(/\/org\/people/)
})

test('signing in from a deep Platform link returns to it', async ({ page }) => {
  await page.goto('/org/settings/members?search=rae')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=/)
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(
    '/org/settings/members?search=rae'
  )
  await signInThroughForm(page, adminEmail(), '/org/settings/members?search=rae')
  await expect(page).toHaveURL(/\/org\/settings\/members\?search=rae$/)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
})

test('zone pages carry the security headers and load their assets under the base path', async ({
  page,
}) => {
  await signIn(page, adminEmail(), '/org/home')
  const response = await page.goto('/org/home')
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toBeTruthy()
  expect(headers['x-content-type-options']).toBe('nosniff')
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
  await signIn(page, adminEmail(), legacy('/skills'))
  await page.setExtraHTTPHeaders({ 'x-sim-legacy-url': legacy('/home') })
  await page.goto(legacy('/skills'))
  await expect(page).toHaveURL(new RegExp(`${legacy('/skills')}$`))
})
