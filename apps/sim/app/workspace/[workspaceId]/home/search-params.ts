import { parseAsIsoDate, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'

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

/** The recency windows a search can be narrowed to; `custom` reads its bounds from `from` and `to`. */
export const UPDATED_WINDOWS = [
  { id: 'any', label: 'Any time', days: null },
  { id: '7d', label: 'Past week', days: 7 },
  { id: '30d', label: 'Past month', days: 30 },
  { id: 'custom', label: 'Custom range', days: null },
] as const
const UPDATED_WINDOW_IDS = UPDATED_WINDOWS.map((window) => window.id)

/**
 * Shared result filters for organization search. `source` is a connector type
 * or `upload`, absent for every source; `from` and `to` are the days of a custom
 * window, inclusive, and mean nothing unless `updated` is `custom`.
 */
export const searchFilterParsers = {
  source: parseAsString,
  updated: parseAsStringLiteral(UPDATED_WINDOW_IDS).withDefault('any'),
  from: parseAsIsoDate,
  to: parseAsIsoDate,
} as const

/**
 * The picker names calendar days; the URL keeps them as dates. A day's bounds are its local
 * midnight and the last millisecond before the next, so "September 1" means the reader's own day.
 */
function startOfLocalDay(day: Date): Date {
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
}
function endOfLocalDay(day: Date): Date {
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 0, 0, 0, -1)
}

/** Resolve the shared source/recency controls once for a particular search. */
export function searchFiltersFromParams(
  params: { source: string | null; updated: (typeof UPDATED_WINDOWS)[number]['id']; from?: Date | null; to?: Date | null },
  searchedAt: number
): WorkspaceSearchFilters {
  const days = UPDATED_WINDOWS.find((entry) => entry.id === params.updated)?.days
  return {
    ...(params.updated === 'custom' && params.from && params.to
      ? { modifiedAfter: startOfLocalDay(params.from).toISOString(), modifiedBefore: endOfLocalDay(params.to).toISOString() }
      : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(days ? { modifiedAfter: new Date(searchedAt - days * 86_400_000).toISOString() } : {}),
  }
}
