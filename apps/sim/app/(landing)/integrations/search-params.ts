import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query params for the integrations catalog. Shared by the
 * client grid (`useQueryStates`) and the server page (`integrationsSearchParamsCache`)
 * so the filtered view is server-rendered for shareable, crawlable `?category=`/`?q=`
 * URLs — the same SSR pattern the blog index uses.
 *
 * - `q` is the search filter; its URL write is debounced on the setter, never
 *   written per keystroke.
 * - `category` filters by integration type (`''` = all).
 */
export const integrationsParsers = {
  q: parseAsString.withDefault(''),
  category: parseAsString.withDefault(''),
}

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const integrationsUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export const integrationsSearchParamsCache = createSearchParamsCache(integrationsParsers)
