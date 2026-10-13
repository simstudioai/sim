import { parseAsStringLiteral } from 'nuqs/server'
import {
  RECENTLY_DELETED_FILTERS,
  RECENTLY_DELETED_SORT_COLUMNS,
} from '@/lib/api/contracts/recently-deleted'
import { createSortParams } from '@/lib/url-state'

/**
 * Shared `sort` + `dir` params for the deleted-items list. Default sort:
 * most-recently-deleted first. Consumed via `useUrlSort` in
 * `recently-deleted.tsx`.
 */
export const recentlyDeletedSortParams = createSortParams(RECENTLY_DELETED_SORT_COLUMNS, {
  column: 'deleted',
  direction: 'desc',
})

/**
 * Co-located, typed URL query-param definitions for the Recently Deleted
 * settings view.
 *
 * - `tab` is the active resource-type filter.
 * - `sort` / `dir` live in {@link recentlyDeletedSortParams} (shared sort
 *   convention).
 * - The name filter is the settings-wide `?search=` key, owned by
 *   `settingsSearchParam` and consumed through `useSettingsSearch` — it is
 *   deliberately not redeclared here (two definitions of one wire key drift).
 */
export const recentlyDeletedParsers = {
  tab: parseAsStringLiteral(RECENTLY_DELETED_FILTERS).withDefault('all'),
} as const

/** Tab/filter/sort view-state: clean URLs, no back-stack churn. */
export const recentlyDeletedUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
