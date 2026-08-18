/**
 * Cookie-consent runtime configuration.
 *
 * Lives in `lib` rather than beside the banner because the CSP builder
 * (`lib/core/security/csp`) has to allow the same origin the runtime calls —
 * two copies of the URL would drift, and the failure mode is silent: a blocked
 * request makes the runtime fall back to an offline policy that shows the
 * banner to every visitor worldwide and records nothing.
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

/**
 * Reopens the consent banner in its expanded state.
 *
 * The consent runtime mounts beside the app rather than wrapping it, so a
 * surface that wants to reopen the banner — the Cookie Policy's "Change your
 * cookie choices" control — cannot reach the store through a React context. A
 * window event keeps that isolation intact and stays a one-shot command rather
 * than state anything has to hold.
 */
export const OPEN_CONSENT_PREFERENCES_EVENT = 'sim:open-consent-preferences'
