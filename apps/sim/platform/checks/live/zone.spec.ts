import { expect, test } from '@playwright/test'
import {
  adminEmail,
  organizationId,
  signIn,
  signInThroughForm,
} from '@/platform/checks/live/session'

const legacy = (path: string) => `/o/${organizationId()}${path}`

const REDIRECTS: readonly (readonly [string, string])[] = [
  ['', '/platform/home'],
  ['/home', '/platform/home'],
  ['/people', '/platform/people'],
  ['/settings', '/platform/settings'],
  ['/settings/members', '/platform/settings/members'],
  ['/settings/team', '/platform/settings/members'],
  ['/settings/subscription?from=mail', '/platform/settings/billing?from=mail'],
  ['/settings/general?view=privacy', '/platform/settings/privacy'],
  ['/links?search=hand', '/platform/settings/links?search=hand'],
  ['/search?q=renewal', '/platform/search?q=renewal'],
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
  await expect(page).toHaveURL(/\/platform\/people/)
})

test('signing in from a deep Platform link returns to it', async ({ page }) => {
  await page.goto('/platform/settings/members?search=rae')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=/)
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(
    '/platform/settings/members?search=rae'
  )
  await signInThroughForm(page, adminEmail(), '/platform/settings/members?search=rae')
  await expect(page).toHaveURL(/\/platform\/settings\/members\?search=rae$/)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
})

test('zone pages carry the security headers and load their assets under the base path', async ({
  page,
}) => {
  await signIn(page, adminEmail(), '/platform/home')
  const response = await page.goto('/platform/home')
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
    expect(new URL(asset, page.url()).pathname).toMatch(/^\/platform\/_next\//)
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
