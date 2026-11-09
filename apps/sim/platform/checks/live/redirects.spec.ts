import { expect } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import { signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** A seeded workspace (`scripts/platform-live-seed.ts`). */
const WORKSPACE = '/workspace/platform-live-workspace-main'

/** Saved links from before the product routes, each to where it now lands, query kept. */
const REDIRECTS: readonly (readonly [string, string])[] = [
  [liveRoute('/settings/team'), liveRoute('/settings/members')],
  [liveRoute('/settings/subscription?from=mail'), liveRoute('/settings/billing?from=mail')],
  [liveRoute('/links?search=hand'), liveRoute('/settings/links?search=hand')],
  [`${WORKSPACE}/w`, `${WORKSPACE}/workflows`],
]

for (const [from, to] of REDIRECTS) {
  test(`a saved ${from} lands on ${to}`, async ({ page }) => {
    await signInAsAdmin(page, from)
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(to)}$`))
  })
}

test('the retired /org paths lead to the product home', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.goto('/org/settings/members')
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(liveRoute('/home'))}(?:\\?|$)`))
})

test('product pages carry the security headers', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const response = await page.goto(liveRoute('/home'))
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toBeTruthy()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
})
