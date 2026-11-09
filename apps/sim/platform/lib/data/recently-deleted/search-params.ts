import { parseAsStringLiteral } from 'nuqs/server'
import {
  RECENTLY_DELETED_SORT_COLUMNS,
  type RecentlyDeletedFilter,
} from '@/lib/api/contracts/recently-deleted'
import { createSortParams } from '@/lib/url-state'

/**
 * Legacy's tabs without Chats: deleted chats belong to the organization and are restored from its
 * Settings, so the workspace view does not list them twice.
 */
export const WORKSPACE_RECENTLY_DELETED_FILTERS = [
  'all',
  'table',
  'file',
  'knowledge',
  'workflow',
  'folder',
] as const satisfies readonly RecentlyDeletedFilter[]

/** Most recently deleted first, legacy's default. */
export const recentlyDeletedSortParams = createSortParams(RECENTLY_DELETED_SORT_COLUMNS, {
  column: 'deleted',
  direction: 'desc',
})

/** The active type tab; the name filter is the settings-wide `?search=` key. */
export const recentlyDeletedParsers = {
  tab: parseAsStringLiteral(WORKSPACE_RECENTLY_DELETED_FILTERS).withDefault('all'),
} as const

/** Tab and sort view state: clean URLs, no back-stack churn. */
export const recentlyDeletedUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
