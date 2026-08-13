import type { QueryClient } from '@tanstack/react-query'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { listTables } from '@/lib/table'
import { toTableListItem } from '@/lib/table/wire'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
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
 * Both read the data layer directly, with no internal HTTP hop. Folders are
 * mapped with the same `mapFolder` the hook applies, matching the workspace
 * sidebar prefetch. Tables go through {@link toTableListItem}, the projection
 * `GET /api/table` itself returns — table definitions carry `Date` fields whose
 * *serialized* form is what the client caches, and the list contract's response
 * schema is a passthrough that neither coerces nor strips, so seeding raw rows
 * would put `Date` objects under a key a client fetch fills with ISO strings.
 *
 * Neither read carries authorization of its own, so the viewer is proved first.
 * `getWorkspaceHostContextForViewer` resolves the same effective workspace
 * permission the route's own check does (both bottom out in
 * `checkWorkspaceAccess`), and it is `cache`d and already resolved by the layout
 * for this request, so it costs no additional queries. A viewer without access
 * caches nothing and the client fetch reaches the route for the real 403.
 */
export async function prefetchTables(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  const hostContext = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null

  await Promise.all([
    ...(hostContext
      ? [
          queryClient.prefetchQuery({
            queryKey: tableKeys.list(workspaceId, 'active'),
            queryFn: async () => {
              const tables = await listTables(workspaceId, { scope: 'active' })
              return tables.map(toTableListItem)
            },
            staleTime: TABLE_LIST_STALE_TIME,
          }),
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
    prefetchResourceListChrome(queryClient, workspaceId, 'table', userId),
  ])
}
