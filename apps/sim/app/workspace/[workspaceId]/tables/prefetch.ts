import type { QueryClient } from '@tanstack/react-query'
import type { FolderApi } from '@/lib/api/contracts/folders'
import type { TableDefinition } from '@/lib/table'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { TABLE_LIST_STALE_TIME, tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Prefetches the workspace's tables list and its table folder tree under the same
 * query keys the client `useTablesList` / `useFolders` hooks use (scope `active`),
 * so the list paints populated on first render. Both are needed: a table row is
 * only placed correctly relative to the folder rows it sits beside, so
 * prefetching one without the other still flashes an ungrouped list.
 *
 * Table definitions carry `Date` fields, so the list goes through the
 * `/api/table` route and caches the serialized wire shape — see
 * {@link prefetchInternalJson}. Folders are mapped with the same `mapFolder` the
 * hook applies so the hydrated entry matches a client fetch exactly.
 */
export async function prefetchTables(queryClient: QueryClient, workspaceId: string): Promise<void> {
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
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'active', 'table'),
      queryFn: async () => {
        const { folders } = await prefetchInternalJson<{ folders?: FolderApi[] }>(
          `/api/folders?workspaceId=${workspaceId}&scope=active&resourceType=table`
        )
        return (folders ?? []).map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
  ])
}
