import type { QueryClient } from '@tanstack/react-query'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import type { TableDefinition } from '@/lib/table'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
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
 * Folders read the data layer and are mapped with the same `mapFolder` the hook
 * applies, matching the workspace sidebar prefetch. That read carries no
 * authorization of its own, so the viewer is proved first;
 * `getWorkspaceHostContextForViewer` is `cache`d and the layout has already
 * resolved it for this request, so it costs no additional queries.
 *
 * Table definitions carry `Date` fields whose serialized wire shape is what the
 * client hook caches, so the list still goes through the `/api/table` route —
 * see {@link prefetchInternalJson}. Converting it needs the payload shaped to
 * the route's response contract, not just read from the data layer.
 */
export async function prefetchTables(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  const hostContext = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null

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
    ...(hostContext
      ? [
          queryClient.prefetchQuery({
            queryKey: folderKeys.list(workspaceId, 'active', 'table'),
            queryFn: async () => {
              const rows = await listFoldersForWorkspace(workspaceId, 'active', 'table')
              return rows.map(mapFolder)
            },
            staleTime: FOLDER_LIST_STALE_TIME,
          }),
        ]
      : []),
    prefetchResourceListChrome(queryClient, workspaceId, 'table'),
  ])
}
