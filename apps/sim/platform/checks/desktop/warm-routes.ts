import {
  DESKTOP_FIXTURE_READY_TIMEOUT_MS,
  desktopOrigin,
  fixtureUrl,
} from '@/platform/checks/routes'
import { warmPages } from '@/platform/checks/warm-pages'

/**
 * The routes a fresh desktop profile walks through first: `APP_ENTRY_ROUTE` in `apps/desktop`,
 * then the workspace resolver it hands off to. Each answers with a page that navigates on, which a
 * request does not follow, so every hop is warmed by name.
 */
const DESKTOP_ENTRY_ROUTES = ['/home', '/workspace']

/** The product routes the renderer spec opens or navigates to. */
const SPEC_ROUTES = ['/home', '/integrations', '/integrations/gmail', '/chat/weekly-review']

/**
 * Compiles everything the desktop window's first load and the spec's routes request before
 * Electron starts. The shell's load watchdog swaps a window still loading after 30 seconds to its
 * offline page, so a warmed document with cold chunks still fails, which is why the chunks each
 * document names are warmed too.
 */
export default async function warmRoutes() {
  await warmPages(
    [
      ...DESKTOP_ENTRY_ROUTES.map((route) => `${desktopOrigin}${route}`),
      ...SPEC_ROUTES.map((route) => fixtureUrl(route, desktopOrigin)),
    ],
    DESKTOP_FIXTURE_READY_TIMEOUT_MS
  )
}
