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
  ['home', '/org/home'],
  ['chat-new', '/org/chat'],
  ['chat-existing', '/org/chat/11111111-1111-4111-8111-111111111111'],
  ['search', '/org/search'],
  ['people-directory', '/org/people?view=directory'],
  ['people-chart', '/org/people?view=chart'],
  ['people-profile', '/org/people/platform-live-directory-admin'],
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
