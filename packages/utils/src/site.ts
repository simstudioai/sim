/**
 * Canonical origin of the public Sim marketing site. No trailing slash.
 *
 * Always the `www` host: the apex `https://sim.ai` 301s here, so linking the
 * apex costs every visitor and crawler a redirect hop. This is a fixed public
 * address, not the deployment's own URL (`NEXT_PUBLIC_APP_URL`), which differs
 * on self-hosted and staging deployments.
 */
export const SIM_SITE_URL = 'https://www.sim.ai'

/** Canonical origin of the public Sim docs site. No trailing slash. */
export const SIM_DOCS_URL = 'https://docs.sim.ai'
