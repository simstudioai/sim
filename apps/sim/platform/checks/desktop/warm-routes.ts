import {
  DESKTOP_FIXTURE_READY_TIMEOUT_MS,
  desktopOrigin,
  fixtureUrl,
} from '@/platform/checks/routes'
import { warmPages } from '@/platform/checks/warm-pages'

/** The route a fresh desktop profile opens first (`APP_ENTRY_ROUTE` in `apps/desktop`). */
const DESKTOP_ENTRY_ROUTE = '/home'

/** The product routes the renderer spec opens or navigates to. */
const SPEC_ROUTES = ['/home', '/integrations', '/integrations/gmail', '/chat/weekly-review']

/**
 * Compiles everything the desktop window's first load and the spec's routes request before
 * Electron starts. The shell's load watchdog swaps a window still loading after 30 seconds to its
 * offline page, so a warmed document with cold chunks still fails, which is why the chunks each
 * document names are warmed too. The entry route is requested unprefixed, so it warms the page a
 * fresh profile is redirected to.
 */
export default async function warmRoutes() {
  await warmPages(
    [
      `${desktopOrigin}${DESKTOP_ENTRY_ROUTE}`,
      ...SPEC_ROUTES.map((route) => fixtureUrl(route, desktopOrigin)),
    ],
    DESKTOP_FIXTURE_READY_TIMEOUT_MS
  )
}
