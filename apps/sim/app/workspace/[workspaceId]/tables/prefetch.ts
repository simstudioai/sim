import type { QueryClient } from '@tanstack/react-query'
import type { TableDefinition } from '@/lib/table/types'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { prefetchResourceFolders } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-folders'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import { TABLE_LIST_STALE_TIME, tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Prefetches the workspace's tables list and its table folder tree — plus the pinned ids and
 * members {@link prefetchResourceListChrome} covers — under the same
 * query keys the client `useTablesList` / `useFolders` hooks use (scope `active`),
 * so the list paints populated on first render. Both are needed: a table row is
 * only placed correctly relative to the folder rows it sits beside, so
 * prefetching one without the other still flashes an ungrouped list.
 *
 * The tables list is the one read on this page still served over HTTP rather than from the data
 * layer, and deliberately so. `listTables` lives in `lib/table/service`, whose module graph
 * reaches `workflow-columns` — by several independent paths, including `jobs/service` and
 * `rows/service` — and through it the executor and the executable tool registry. Importing it
 * here put ~4,700 modules into this page's server graph, which `check:tool-registry-boundary`
 * catches. Converting this read means untangling `lib/table`'s internals first; until then the
 * route stays the cheaper option. See {@link prefetchInternalJson}.
 *
 * Folders and the chrome reads both go through the data layer and prove the viewer themselves,
 * so an unproven viewer caches nothing and their client fetch reaches the route for the real 403.
 */
export async function prefetchTables(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: tableKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const response = await prefetchInternalJson<{ data: { tables: TableDefinition[] } }>(
          `/api/table?workspaceId=${workspaceId}&scope=active`
        )
        return response.data.tables
      },
      staleTime: TABLE_LIST_STALE_TIME,
    }),
    prefetchResourceFolders(queryClient, workspaceId, 'table', userId),
    prefetchResourceListChrome(queryClient, workspaceId, 'table', userId),
  ])
}
