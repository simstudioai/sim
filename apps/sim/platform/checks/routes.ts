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

/**
 * The fixture development server's environment and readiness deadline. Its first request
 * cold-compiles the whole app under Turbopack, 60-185s on a healthy CI runner and past 300s on a
 * degraded one, so the deadline matches `.github/scripts/http-e2e.sh`'s.
 */
export const FIXTURE_SERVER_ENV = {
  SIM_PLATFORM_FIXTURES: '1',
  DISABLE_TELEMETRY: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
}
export const FIXTURE_READY_TIMEOUT_MS = 600_000
/** The 3-core macOS runner the Electron checks need compiles the same app well past that. */
export const DESKTOP_FIXTURE_READY_TIMEOUT_MS = 1_200_000
