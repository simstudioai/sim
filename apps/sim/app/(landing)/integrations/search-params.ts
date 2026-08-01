import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query params for the integrations catalog. Shared by the
 * client grid (`useQueryStates`) and the server page (`integrationsSearchParamsCache`)
 * so the filtered view is server-rendered for shareable, crawlable `?category=`/`?q=`
 * URLs — the same SSR pattern the blog index uses.
 *
 * - `q` is the search filter; its URL write is debounced via
 *   `useDebouncedSearchSetter`, never written per keystroke.
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

/**
 * Parsing this in the page's server component opts the route into dynamic
 * rendering, which populates `useSearchParams` during the server render — so the
 * client grid's `useQueryStates` filters server-side and the initial HTML ships
 * the filtered catalog (crawlable, shareable), with no post-hydration swap.
 */
export const integrationsSearchParamsCache = createSearchParamsCache(integrationsParsers)
