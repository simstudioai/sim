import { escapeRegExp } from '@sim/utils/string'

/**
 * Where the browser checks reach the Platform. A spec names a route by its path in the product
 * (`/home`, `/settings/members`, `/workspace/it/logs`); this module alone knows which server serves
 * it and at what URL, so moving the routes is an edit here and nowhere else.
 */

/** The fixture server the design checks start, unless one already runs at `PLATFORM_E2E_ORIGIN`. */
export const FIXTURE_PORT = 3181
/** The server with fixtures off, which renders each route's empty state. */
export const FIXTURES_OFF_PORT = 3180
/** The fixture server the desktop shell opens. */
export const DESKTOP_PORT = 3182

export const fixtureOrigin = process.env.PLATFORM_E2E_ORIGIN ?? `http://127.0.0.1:${FIXTURE_PORT}`
export const fixturesOffOrigin = `http://127.0.0.1:${FIXTURES_OFF_PORT}`
export const desktopOrigin = process.env.PLATFORM_E2E_ORIGIN ?? `http://127.0.0.1:${DESKTOP_PORT}`

/** `route` on the fixture server, or on another server of the same build at `origin`. */
export const fixtureUrl = (route: string, origin = fixtureOrigin) => `${origin}${route}`

/** `route` on the live app, relative to its `baseURL`. */
export const liveRoute = (route: string) => `/org${route}`

/** Matches a URL on the live `route` followed by `rest`, a regular expression source. */
export const liveRoutePattern = (route: string, rest = '') =>
  new RegExp(`${escapeRegExp(liveRoute(route))}${rest}`)

/** Matches the login page a signed-out visit to the live `route` lands on, sent back to it. */
export const liveLoginPattern = (route: string) =>
  new RegExp(`/login\\?.*callbackUrl=${escapeRegExp(encodeURIComponent(liveRoute(route)))}`)

/** Serves the production build on `port`, run from `apps/sim`. */
export const productionServer = (port: number) =>
  `bunx --no-install next start platform -H 127.0.0.1 -p ${port}`
