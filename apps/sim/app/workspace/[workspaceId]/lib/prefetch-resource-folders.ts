import type { QueryClient } from '@tanstack/react-query'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { FOLDER_LIST_STALE_TIME, folderKeys, mapFolder } from '@/hooks/queries/utils/folder-keys'

/**
 * Prefetches one resource family's folder tree under the same key its client
 * `useFolders` hook reads, mapped with the same `mapFolder` the hook applies so a
 * hydrated entry matches a client fetch.
 *
 * Shared by the resource list pages so the key, stale time, and mapper cannot
 * drift apart across them. Self-guarding like {@link prefetchResourceListChrome}:
 * the read carries no authorization of its own, so an unproven viewer caches
 * nothing and their client fetch reaches the route for the real 403.
 * `getWorkspaceHostContextForViewer` is `cache`d and the layout has already
 * resolved it for this request, so the proof costs no additional queries.
 */
export async function prefetchResourceFolders(
  queryClient: QueryClient,
  workspaceId: string,
  resourceType: FolderResourceType,
  userId: string | undefined
): Promise<void> {
  if (!userId) return
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

  await queryClient.prefetchQuery({
    queryKey: folderKeys.list(workspaceId, 'active', resourceType),
    queryFn: async () => {
      const rows = await listFoldersForWorkspace(workspaceId, 'active', resourceType)
      return rows.map(mapFolder)
    },
    staleTime: FOLDER_LIST_STALE_TIME,
  })
}
