export const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sim.ai'
/**
 * The public marketing site's fixed canonical origin — not `NEXT_PUBLIC_APP_URL`.
 * That env var reflects wherever *this* deployment (self-hosted or otherwise)
 * happens to run, but the footer's marketing links (`/blog`, `/enterprise`,
 * `/models`, `/terms`, `/privacy`, …) only ever exist on sim.ai itself, so
 * they must stay hardcoded to it regardless of where docs is hosted.
 */
export const SIM_SITE_URL = 'https://sim.ai'
