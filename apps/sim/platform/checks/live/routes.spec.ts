import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import {
  adminEmail,
  memberEmail,
  organizationId,
  reportDir,
  signIn,
} from '@/platform/checks/live/session'

/**
 * Opens every route the way a member would, in both themes at desktop and narrow widths, and leaves
 * a screenshot of each. A route fails on what a person would call broken even when the page looks
 * rendered: an uncaught error, a hydration mismatch, a CSP block, or a server error behind it.
 */
const SCREENSHOTS = path.join(reportDir, 'screenshots')

const ADMIN_ROUTES = [
  ['home', '/org/home'],
  ['chat-new', '/org/chat'],
  ['chat-existing', '/org/chat/11111111-1111-4111-8111-111111111111'],
  ['search', '/org/search'],
  ['people-directory', '/org/people?view=directory'],
  ['people-chart', '/org/people?view=chart'],
  ['integrations', '/org/integrations'],
  ['settings-preferences', '/org/settings'],
  ['settings-notifications', '/org/settings/notifications'],
  ['settings-shortcuts', '/org/settings/keyboard-shortcuts'],
  ['settings-privacy', '/org/settings/privacy'],
  ['settings-account', '/org/settings/account'],
  ['settings-recently-deleted', '/org/settings/recently-deleted'],
  ['settings-members', '/org/settings/members'],
  ['settings-requests', '/org/settings/requests'],
  ['settings-billing', '/org/settings/billing'],
  ['settings-usage', '/org/settings/usage'],
  ['settings-usage-events', '/org/settings/usage/events'],
  ['settings-links', '/org/settings/links'],
  ['settings-whitelabeling', '/org/settings/whitelabeling'],
  ['settings-audit-logs', '/org/settings/audit-logs'],
  ['settings-access-control', '/org/settings/access-control'],
  ['settings-sso', '/org/settings/sso'],
  ['settings-security', '/org/settings/security'],
  ['settings-data-retention', '/org/settings/data-retention'],
  ['settings-data-drains', '/org/settings/data-drains'],
] as const

const MEMBER_ROUTES = [
  ['member-home', '/org/home'],
  ['member-settings-members', '/org/settings/members'],
] as const

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'narrow', width: 390, height: 844 },
] as const

const THEMES = ['light', 'dark'] as const

/** Everything a route may do wrong without its page failing to render. */
function watchForBreakage(page: Page) {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/content security policy|hydrat|minified react error/i.test(text)) {
      problems.push(`console: ${text}`)
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (
      response.status() >= 500 ||
      (url.pathname.includes('/_next/') && response.status() >= 400)
    ) {
      problems.push(`${response.status()} ${response.request().method()} ${url.pathname}`)
    }
  })
  return problems
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
}

async function visitEverywhere(page: Page, name: string, route: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const colorScheme of THEMES) {
      await page.emulateMedia({ colorScheme })
      const response = await page.goto(route)
      expect(response?.status(), `${route} status`).toBeLessThan(400)
      await settle(page)
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${name}-${viewport.name}-${colorScheme}.png`),
        fullPage: true,
      })
      const unstyled = await page.evaluate(() =>
        getComputedStyle(document.body).fontFamily.includes('Times')
      )
      expect(unstyled, `${route} rendered with no stylesheet`).toBe(false)
      const text = (await page.locator('main, [data-platform-ui]').first().innerText()).trim()
      expect(text.length, `${route} rendered an empty shell`).toBeGreaterThan(0)
    }
  }
}

for (const [routes, email] of [
  [ADMIN_ROUTES, adminEmail],
  [MEMBER_ROUTES, memberEmail],
] as const) {
  for (const [name, route] of routes) {
    test(`${name} renders healthy in both themes at both widths`, async ({ page }) => {
      const problems = watchForBreakage(page)
      await signIn(page, email(), route)
      await visitEverywhere(page, name, route)
      expect(problems).toEqual([])
    })
  }
}

test('people-profile renders healthy in both themes at both widths', async ({ page }) => {
  const problems = watchForBreakage(page)
  await signIn(page, adminEmail(), '/org/people')
  const people = await page.request.get(`/api/organizations/${organizationId()}/people`)
  const { people: rows } = (await people.json()) as { people: { memberId: string }[] }
  const first = rows[0]
  if (!first) throw new Error('The seeded directory is empty')
  await visitEverywhere(page, 'people-profile', `/org/people/${first.memberId}`)
  expect(problems).toEqual([])
})

test('Each route names its own tab', async ({ page }) => {
  await signIn(page, adminEmail(), '/org/home')
  const titles = [
    ['/org/home', 'Home'],
    ['/org/search', 'Search'],
    ['/org/chat', 'Chat'],
    ['/org/integrations', 'Integrations'],
    ['/org/settings', 'General'],
    ['/org/settings/members', 'Members'],
    ['/org/settings/usage/events', 'Usage events'],
  ]
  for (const [route, title] of titles) {
    await page.goto(route as string)
    await expect(page).toHaveTitle(title as string)
  }
})
