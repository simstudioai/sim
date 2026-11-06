import type {
  RecentlyDeletedFilter,
  RecentlyDeletedSortColumn,
} from '@/lib/api/contracts/recently-deleted'
import type { ListSortOrder } from '@/lib/api/list-query'

/**
 * Standalone so each resource's restore mutation can invalidate the Recently Deleted view
 * without importing its hook module. A restore can bring back more than the row it was
 * called on (a folder restores its contents), so the whole view refetches.
 */
export const recentlyDeletedKeys = {
  all: ['recentlyDeleted'] as const,
  lists: () => [...recentlyDeletedKeys.all, 'list'] as const,
  /** Every list in one workspace — the scope a previous page may be carried within. */
  workspaceLists: (workspaceId: string) => [...recentlyDeletedKeys.lists(), workspaceId] as const,
  list: (
    workspaceId: string,
    filter: RecentlyDeletedFilter,
    search: string | undefined,
    sortBy: RecentlyDeletedSortColumn,
    sortOrder: ListSortOrder
  ) =>
    [
      ...recentlyDeletedKeys.workspaceLists(workspaceId),
      filter,
      search ?? '',
      sortBy,
      sortOrder,
    ] as const,
}
