import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query params for the models directory. Shared by the
 * client directory (`useQueryStates`) and the server page (`modelsSearchParamsCache`)
 * so the filtered view is server-rendered for shareable, crawlable `?provider=`/`?q=`
 * URLs — the same SSR pattern the blog index uses.
 *
 * - `q` is the search filter; its URL write is debounced on the setter, never
 *   written per keystroke.
 * - `provider` filters by provider id (`''` = all).
 */
export const modelsParsers = {
  q: parseAsString.withDefault(''),
  provider: parseAsString.withDefault(''),
}

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const modelsUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export const modelsSearchParamsCache = createSearchParamsCache(modelsParsers)
