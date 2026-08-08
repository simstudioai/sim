import type { QueryClient } from '@tanstack/react-query'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import type { TableDefinition } from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import { FOLDER_LIST_STALE_TIME, folderKeys, mapFolder } from '@/hooks/queries/utils/folder-keys'
import { TABLE_LIST_STALE_TIME, tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Prefetches the workspace's tables list and its table folder tree — plus the pinned ids and
 * members {@link prefetchResourceListChrome} covers — under the same
 * query keys the client `useTablesList` / `useFolders` hooks use (scope `active`),
 * so the list paints populated on first render. Both are needed: a table row is
 * only placed correctly relative to the folder rows it sits beside, so
 * prefetching one without the other still flashes an ungrouped list.
 *
 * The tables list goes through its route rather than the data layer — see
 * {@link prefetchInternalJson}. Folders are mapped with the same `mapFolder` the hook
 * applies, so that entry matches a client fetch exactly.
 */
export async function prefetchTables(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) return

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
        const folders = await listFoldersForWorkspace(workspaceId, 'active', 'table')
        return folders.map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, userId, 'table'),
  ])
}
