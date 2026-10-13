import { useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listRecentlyDeletedContract,
  type RecentlyDeletedFilter,
  type RecentlyDeletedSortColumn,
} from '@/lib/api/contracts/recently-deleted'
import type { ListSortOrder } from '@/lib/api/list-query'
import { recentlyDeletedKeys } from '@/hooks/queries/utils/recently-deleted-keys'
import { shouldRetrySettingsRead } from '@/hooks/queries/utils/settings-read-retry'

/** Always refetched on open, so a resource deleted anywhere else shows up here. */
const RECENTLY_DELETED_STALE_TIME = 0

interface RecentlyDeletedListParams {
  workspaceId: string
  filter: RecentlyDeletedFilter
  search?: string
  sortBy: RecentlyDeletedSortColumn
  sortOrder: ListSortOrder
}

/** The Recently Deleted view, one server-searched, server-sorted page at a time. */
export function useRecentlyDeletedItems({
  workspaceId,
  filter,
  search,
  sortBy,
  sortOrder,
}: RecentlyDeletedListParams) {
  const normalizedSearch = search || undefined
  return useInfiniteQuery({
    queryKey: recentlyDeletedKeys.list(workspaceId, filter, normalizedSearch, sortBy, sortOrder),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listRecentlyDeletedContract, {
        params: { id: workspaceId },
        query: { type: filter, search: normalizedSearch, sortBy, sortOrder, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
    staleTime: RECENTLY_DELETED_STALE_TIME,
    placeholderData: (previous, previousQuery) =>
      recentlyDeletedKeys
        .workspaceLists(workspaceId)
        .every((part, index) => previousQuery?.queryKey[index] === part)
        ? previous
        : undefined,
    retry: shouldRetrySettingsRead,
  })
}
