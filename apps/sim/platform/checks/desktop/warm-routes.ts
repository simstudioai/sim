import { request } from '@playwright/test'
import {
  DESKTOP_FIXTURE_READY_TIMEOUT_MS,
  desktopOrigin,
  fixtureUrl,
} from '@/platform/checks/routes'

/** The route a fresh desktop profile opens first (`APP_ENTRY_ROUTE` in `apps/desktop`). */
const DESKTOP_ENTRY_ROUTE = '/home'

/** The product routes the renderer spec opens or navigates to. */
const SPEC_ROUTES = ['/home', '/integrations', '/integrations/gmail', '/chat/weekly-review']

/**
 * Compiles every route the desktop spec reaches before Electron starts. The development server
 * compiles a route on its first visit, minutes on the macOS runner, and Playwright reports no
 * Electron window until that window's first navigation commits, so a cold entry route outlasts
 * `firstWindow` and the shell's own load watchdog. Redirects are followed, so the entry route
 * warms the page a signed-out profile lands on. Playwright's request client, unlike `fetch`, has
 * no fixed five-minute wait for response headers.
 */
export default async function warmRoutes() {
  const context = await request.newContext({ timeout: DESKTOP_FIXTURE_READY_TIMEOUT_MS })
  try {
    for (const url of [
      `${desktopOrigin}${DESKTOP_ENTRY_ROUTE}`,
      ...SPEC_ROUTES.map((route) => fixtureUrl(route, desktopOrigin)),
    ]) {
      await context.get(url)
    }
  } finally {
    await context.dispose()
  }
}
