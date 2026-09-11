import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

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

/** The recency windows a search can be narrowed to. */
export const UPDATED_WINDOWS = [
  { id: 'any', label: 'Any time', days: null },
  { id: '7d', label: 'Past week', days: 7 },
  { id: '30d', label: 'Past month', days: 30 },
] as const
const UPDATED_WINDOW_IDS = UPDATED_WINDOWS.map((window) => window.id)

/**
 * Shared result filters for organization search. `source` is a connector type
 * or `upload`, absent for every source.
 */
export const searchFilterParsers = {
  source: parseAsString,
  updated: parseAsStringLiteral(UPDATED_WINDOW_IDS).withDefault('any'),
} as const
