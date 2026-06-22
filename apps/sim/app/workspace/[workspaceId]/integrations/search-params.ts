import { parseAsString } from 'nuqs/server'

/** Default category — the unfiltered "All" view. */
export const ALL_CATEGORY = 'All'
/** Pinned, curated home-row section. */
export const FEATURED_LABEL = 'Featured'
/** Connected-credentials section (only shown when the user has connections). */
export const CONNECTED_LABEL = 'Connected'

/**
 * Co-located, typed URL query-param definitions for the Integrations gallery.
 *
 * - `category` selects the active integration category tab. Categories mix the
 *   `IntegrationType` enum values with the `All`/`Featured`/`Connected`
 *   pseudo-categories and are derived from the data set, so a plain string is
 *   used; the `All` default clears from the URL.
 * - `search` is the integration search term. The input is controlled directly by
 *   the nuqs value; only its URL write is debounced via `limitUrlUpdates`
 *   (`debounce`) on the setter — never written on every keystroke.
 */
export const integrationsParsers = {
  category: parseAsString.withDefault(ALL_CATEGORY),
  search: parseAsString.withDefault(''),
} as const

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const integrationsUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
