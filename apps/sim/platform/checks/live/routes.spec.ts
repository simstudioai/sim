import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { adminEmail, memberEmail, signIn } from '@/platform/checks/live/session'

/**
 * Opens every route the way a member would, in both themes at desktop and narrow widths, and leaves
 * a screenshot of each. A route fails on what a person would call broken even when the page looks
 * rendered: an uncaught error, a hydration mismatch, a CSP block, or a server error behind it.
 */
const SCREENSHOTS = path.join(
  path.dirname(process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'),
  'screenshots'
)

const ADMIN_ROUTES = [
  ['home', '/platform/home'],
  ['chat-new', '/platform/chat'],
  ['chat-existing', '/platform/chat/11111111-1111-4111-8111-111111111111'],
  ['search', '/platform/search'],
  ['people-directory', '/platform/people?view=directory'],
  ['people-chart', '/platform/people?view=chart'],
  ['people-profile', '/platform/people/platform-live-directory-admin'],
  ['integrations', '/platform/integrations'],
  ['settings-preferences', '/platform/settings'],
  ['settings-notifications', '/platform/settings/notifications'],
  ['settings-shortcuts', '/platform/settings/keyboard-shortcuts'],
  ['settings-privacy', '/platform/settings/privacy'],
  ['settings-account', '/platform/settings/account'],
  ['settings-recently-deleted', '/platform/settings/recently-deleted'],
  ['settings-members', '/platform/settings/members'],
  ['settings-requests', '/platform/settings/requests'],
  ['settings-billing', '/platform/settings/billing'],
  ['settings-usage', '/platform/settings/usage'],
  ['settings-usage-events', '/platform/settings/usage/events'],
  ['settings-links', '/platform/settings/links'],
  ['settings-whitelabeling', '/platform/settings/whitelabeling'],
  ['settings-audit-logs', '/platform/settings/audit-logs'],
  ['settings-access-control', '/platform/settings/access-control'],
  ['settings-sso', '/platform/settings/sso'],
  ['settings-security', '/platform/settings/security'],
  ['settings-data-retention', '/platform/settings/data-retention'],
  ['settings-data-drains', '/platform/settings/data-drains'],
] as const

const MEMBER_ROUTES = [
  ['member-home', '/platform/home'],
  ['member-settings-members', '/platform/settings/members'],
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

for (const [name, route] of [...ADMIN_ROUTES, ...MEMBER_ROUTES]) {
  test(`${name} renders healthy in both themes at both widths`, async ({ page }) => {
    const email = name.startsWith('member-') ? memberEmail() : adminEmail()
    const problems = watchForBreakage(page)
    await signIn(page, email, route)
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
    expect(problems).toEqual([])
  })
}
