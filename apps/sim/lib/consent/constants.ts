/**
 * Cookie-consent runtime configuration. Lives in `lib` so the CSP builder
 * (`lib/core/security/csp`) can allow the same origin without a second copy of
 * the URL to drift.
 *
 * That makes this module part of the config boundary `next.config.ts` loads
 * before the `@/` alias resolves, and it is also pulled into the client bundle
 * by the banner. Keep it dependency-free — reaching for `env-flags` to derive a
 * value here would break the build and drag the whole env schema into the
 * browser chunk, which is why the dev override reads `process.env` directly.
 */

/**
 * Sim's consent instance. Public by construction — the browser calls it
 * directly, so it is a client-visible origin like the GTM and GA container IDs
 * in the root layout, not a credential.
 */
export const CONSENT_BACKEND_URL = 'https://sim-sim.inth.app'

/**
 * Categories offered in the banner, in display order. `necessary` is always
 * granted and renders as a locked row so the list reads complete.
 */
export const CONSENT_CATEGORIES = ['necessary', 'measurement', 'marketing'] as const

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

/**
 * Development-only country override, e.g. `NEXT_PUBLIC_CONSENT_COUNTRY=DE`.
 *
 * The banner is geo-gated by the consent runtime, so outside the EU/UK it never
 * appears and cannot be reviewed locally. This mirrors the `NEXT_PUBLIC_FORCE_HOSTED`
 * escape hatch in `env-flags`: the `NODE_ENV` comparison is a literal Next inlines,
 * so a production build eliminates the branch and can never force a jurisdiction.
 */
export const DEV_CONSENT_COUNTRY =
  process.env.NODE_ENV === 'production' ? undefined : process.env.NEXT_PUBLIC_CONSENT_COUNTRY
