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

/**
 * `q` is the composer's Search-mode query, so a search is a shareable,
 * bookmarkable link. Present only while a search is showing: it is dropped
 * when the box empties, on Summarize, and when the mode leaves Search. The
 * composer reads it once on mount to restore the query and the Search mode.
 * Filter-like, so it replaces the history entry.
 */
export const searchQueryParam = {
  key: 'q',
  parser: parseAsString,
} as const

/** The composer's modes: the agent, enterprise search, or the assistant answering from the sources. */
export const MOTHERSHIP_MODES = ['build', 'search', 'assistant'] as const

export type MothershipMode = (typeof MOTHERSHIP_MODES)[number]

/**
 * `mode` is the composer's mode, so a refresh, back, forward, or shared link
 * lands in the same mode. A missing value falls back to the latest user turn;
 * an explicit Build selection stays in the URL to distinguish it from that fallback.
 */
export const modeParam = {
  key: 'mode',
  parser: parseAsStringLiteral(MOTHERSHIP_MODES).withOptions({
    history: 'replace',
    clearOnDefault: true,
  }),
} as const

/** The recency windows a search can be narrowed to. */
export const UPDATED_WINDOWS = [
  { id: 'any', label: 'Any time', days: null },
  { id: '7d', label: 'Past week', days: 7 },
  { id: '30d', label: 'Past month', days: 30 },
] as const
const UPDATED_WINDOW_IDS = UPDATED_WINDOWS.map((window) => window.id)

/**
 * The result filters, beside `q`, so a narrowed search is the same shareable
 * link as the search itself. `source` is a connector type or `upload`, absent
 * for every source; both are dropped with the query.
 */
export const searchFilterParsers = {
  source: parseAsString,
  updated: parseAsStringLiteral(UPDATED_WINDOW_IDS).withDefault('any'),
} as const

/** Every search param at its default: what leaving a search writes. */
export const CLEARED_SEARCH_FILTERS = { source: null, updated: null } as const

/** A mode transition clears its search query and filters in the same URL update. */
export const composerModeParsers = {
  [modeParam.key]: modeParam.parser,
  [searchQueryParam.key]: searchQueryParam.parser,
  ...searchFilterParsers,
} as const
