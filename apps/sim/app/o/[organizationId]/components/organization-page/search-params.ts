import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for an organization page's
 * header. Both are view state the page's content filters by, so a link carries
 * them and a tab switch keeps them.
 *
 * - `tab` is the active header tab. Absent, the page shows its first tab, so the
 *   key only appears once the viewer leaves it.
 * - `q` is the search field's text, written raw (consumers trim on read) and
 *   debounced on the way to the URL by `useDebouncedSearchSetter`.
 */
export const organizationPageParsers = {
  tab: parseAsString,
  q: parseAsString.withDefault(''),
} as const

/** Tabs and search are filter-like view changes, not navigation: replace, and clear at the default. */
export const organizationPageUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
