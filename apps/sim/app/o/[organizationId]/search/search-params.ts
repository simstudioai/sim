import { parseAsString } from 'nuqs/server'

/**
 * `q` is the Search page's query, so a search is a shareable, bookmarkable link.
 * Written raw (consumers trim on read) and debounced on the way to the URL; the
 * results' own source and recency filters live beside it, declared with the
 * results component.
 */
export const organizationSearchParsers = {
  q: parseAsString.withDefault(''),
} as const

/** A query is a filter-like view change, not navigation: replace, and clear when empty. */
export const organizationSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
