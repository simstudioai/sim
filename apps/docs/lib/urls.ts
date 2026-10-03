import { SIM_DOCS_URL, SIM_SITE_URL } from '@sim/utils/site'

export const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? SIM_DOCS_URL

/**
 * The marketing site's canonical origin, never `NEXT_PUBLIC_APP_URL`: marketing
 * links only exist on sim.ai, wherever docs is hosted.
 */
export { SIM_SITE_URL }
