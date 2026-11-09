import { type APIRequestContext, request } from '@playwright/test'
import {
  DESKTOP_FIXTURE_READY_TIMEOUT_MS,
  desktopOrigin,
  fixtureUrl,
} from '@/platform/checks/routes'

/** The route a fresh desktop profile opens first (`APP_ENTRY_ROUTE` in `apps/desktop`). */
const DESKTOP_ENTRY_ROUTE = '/home'

/** The product routes the renderer spec opens or navigates to. */
const SPEC_ROUTES = ['/home', '/integrations', '/integrations/gmail', '/chat/weekly-review']

/** A static asset a page references, quoted in its markup or its inline flight data. */
const STATIC_ASSET = /["'](\/_next\/static\/[^"'\\\s]+)/g

/** Requests a page as a window does, then every script and stylesheet its document names. */
async function warmPage(context: APIRequestContext, url: string, warmedAssets: Set<string>) {
  const response = await context.get(url, { headers: { accept: 'text/html' } })
  const html = await response.text()
  for (const [, asset] of html.matchAll(STATIC_ASSET)) {
    const assetUrl = new URL(asset, response.url()).href
    if (warmedAssets.has(assetUrl)) continue
    warmedAssets.add(assetUrl)
    await context.get(assetUrl)
  }
}

/**
 * Compiles everything the desktop window's first load and the spec's routes request before
 * Electron starts. The development server compiles a page on its first visit and each client
 * chunk on its first request, minutes on the macOS runner. The shell's load watchdog swaps a
 * window still loading after 30 seconds to its offline page, so a warmed document with cold
 * chunks still fails, which is why the chunks each document names are requested too. Redirects
 * are followed, so the entry route warms the page a fresh profile lands on. Playwright's request
 * client, unlike `fetch`, has no fixed five-minute wait for response headers.
 */
export default async function warmRoutes() {
  const context = await request.newContext({ timeout: DESKTOP_FIXTURE_READY_TIMEOUT_MS })
  const warmedAssets = new Set<string>()
  try {
    for (const url of [
      `${desktopOrigin}${DESKTOP_ENTRY_ROUTE}`,
      ...SPEC_ROUTES.map((route) => fixtureUrl(route, desktopOrigin)),
    ]) {
      await warmPage(context, url, warmedAssets)
    }
  } finally {
    await context.dispose()
  }
}
