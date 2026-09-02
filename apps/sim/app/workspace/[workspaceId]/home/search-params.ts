import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the home/Chat surface.
 *
 * `resource` deep-links the resource panel to the selected resource. The active
 * resource id is the single source of truth for which resource the panel shows;
 * `useChat` reads and writes it through this param, and the effective selection
 * is derived against the loaded resource list (an unknown/stale id falls back to
 * the last resource). The URL key is `resource` — existing shared links depend on
 * it, so it must not be renamed.
 */
export const resourceParam = {
  key: 'resource',
  parser: parseAsString,
} as const

/**
 * Selecting a resource is a filter-like view change, not back-stack navigation,
 * so it replaces the current history entry (matching the previous
 * `window.history.replaceState` behavior). `clearOnDefault` drops the key from
 * the URL when no resource is active.
 */
export const resourceUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `q` is the composer's Search-mode query, so a search is a shareable,
 * bookmarkable link the way a search page's is. Present only while a search
 * is showing; the composer reads it once on mount to restore the query and
 * the Search mode. Filter-like, so it replaces the history entry.
 */
export const searchQueryParam = {
  key: 'q',
  parser: parseAsString,
} as const
