import { useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BackgroundWorkItem,
  type GetWorkspaceBackgroundWorkResponse,
  getWorkspaceBackgroundWorkContract,
} from '@/lib/api/contracts/workspace-fork'

export const backgroundWorkKeys = {
  all: ['backgroundWork'] as const,
  // 'infinite' segments the key from the pre-pagination plain-query era: the data shape
  // under the old key was an array, and an infinite query reading such a cache entry
  // renders as empty. A shape change must always re-key.
  lists: () => [...backgroundWorkKeys.all, 'list', 'infinite'] as const,
  list: (workspaceId?: string) => [...backgroundWorkKeys.lists(), workspaceId ?? ''] as const,
}

export const BACKGROUND_WORK_STALE_TIME = 5_000

/** Page size for the fork Activity feed, matching the audit log's. */
const BACKGROUND_WORK_PAGE_SIZE = '50'

async function fetchWorkspaceBackgroundWork(
  workspaceId: string,
  cursor?: string,
  signal?: AbortSignal
): Promise<GetWorkspaceBackgroundWorkResponse> {
  return requestJson(getWorkspaceBackgroundWorkContract, {
    params: { id: workspaceId },
    query: { cursor, limit: BACKGROUND_WORK_PAGE_SIZE },
    signal,
  })
}

const isActive = (item: BackgroundWorkItem) =>
  item.status === 'pending' || item.status === 'processing'

/**
 * Durable "background work in progress" status for a workspace (fork content copy +
 * any deployment side-effects), keyset-paginated like the enterprise audit log
 * (`getNextPageParam` from the page's `nextCursor`). Poll-first per the best-practice
 * for long jobs: the status survives a reload (it's a DB row), and we only keep
 * polling while something is still running, then stop - the poll refetches every
 * loaded page sequentially with fresh cursors, so pagination stays consistent.
 * Refetch on focus catches changes after the tab was away.
 */
export function useWorkspaceBackgroundWork(workspaceId?: string) {
  return useInfiniteQuery({
    queryKey: backgroundWorkKeys.list(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      fetchWorkspaceBackgroundWork(workspaceId as string, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(workspaceId),
    staleTime: BACKGROUND_WORK_STALE_TIME,
    refetchInterval: (query) =>
      (query.state.data?.pages ?? []).some((page) => page.items.some(isActive)) ? 5_000 : false,
    refetchOnWindowFocus: true,
  })
}
