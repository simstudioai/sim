import { parseAsArrayOf, parseAsString } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

/** Sortable interface columns, matching the `Resource.Options` sort menu. */
export const INTERFACE_SORT_COLUMNS = ['name', 'modules', 'created', 'owner', 'updated'] as const

/**
 * Shared `sort` + `dir` params for the Interfaces list. Default sort:
 * most-recently-updated first. Consumed via `useUrlSort` in `interfaces.tsx`.
 */
export const interfacesSortParams = createSortParams(INTERFACE_SORT_COLUMNS, {
  column: 'updated',
  direction: 'desc',
})

/**
 * Co-located, typed URL query-param definitions for the Interfaces list.
 *
 * - `search` filters on interface name and description. The input is controlled
 *   directly by the nuqs value; only its URL write is debounced via
 *   `useDebouncedSearchSetter`.
 * - `sort` / `dir` live in {@link interfacesSortParams} (shared sort convention).
 * - `owner` filters by creator id and is a multi-select array.
 *
 * Opening an interface navigates to the `interfaces/[interfaceId]` route (via
 * `router`), so the active interface is route state, not query state, and is
 * intentionally not represented here. The list always renders the `active`
 * scope — archived interfaces are restored from Recently Deleted in Settings,
 * so the scope is not a filter either.
 */
export const interfacesParsers = {
  search: parseAsString.withDefault(''),
  owner: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const interfacesUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
