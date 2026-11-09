import { escapeRegExp } from '@sim/utils/string'
import { organizationId } from '@/platform/checks/live/session'

/**
 * Where the browser checks reach the Platform. A spec names a route by its path in the product
 * (`/home`, `/settings/members`, `/workspace/it/logs`); this module alone knows which server serves
 * it and at what URL, so moving the routes is an edit here and nowhere else.
 */

/** The fixture development server the design checks start, unless one already runs at `PLATFORM_E2E_ORIGIN`. */
export const FIXTURE_PORT = 3181
/** The fixture server the desktop shell opens. */
export const DESKTOP_PORT = 3182

export const fixtureOrigin = process.env.PLATFORM_E2E_ORIGIN ?? `http://127.0.0.1:${FIXTURE_PORT}`
export const desktopOrigin = process.env.PLATFORM_E2E_ORIGIN ?? `http://127.0.0.1:${DESKTOP_PORT}`

/** The organization every fixture scenario renders (`fixtures/settings/surface.ts`). */
const FIXTURE_ORGANIZATION_ID = 'sim'

/** Organization pages sit under `/o/<id>`; workspace pages keep their own `/workspace/<id>`. */
function productPath(organization: string, route: string) {
  return route.startsWith('/workspace/') ? route : `/o/${organization}${route}`
}

/** `route` on the fixture server, or on another fixture server at `origin`. */
export const fixtureUrl = (route: string, origin = fixtureOrigin) =>
  `${origin}${productPath(FIXTURE_ORGANIZATION_ID, route)}`

/** `route` on the live app, relative to its `baseURL`, in the seeded organization. */
export const liveRoute = (route: string) => productPath(organizationId(), route)

/** Matches a URL on the live `route` followed by `rest`, a regular expression source. */
export const liveRoutePattern = (route: string, rest = '') =>
  new RegExp(`${escapeRegExp(liveRoute(route))}${rest}`)

/** Matches the login page a signed-out visit to the live `route` lands on, sent back to it. */
export const liveLoginPattern = (route: string) =>
  new RegExp(`/login\\?.*callbackUrl=${escapeRegExp(encodeURIComponent(liveRoute(route)))}`)

/**
 * Serves the main app's development server on `port`, run from `apps/sim`. Example data is a
 * development-only mode: a production build never serves it.
 */
export const fixtureServer = (port: number) => `bunx --no-install next dev -H 127.0.0.1 -p ${port}`
