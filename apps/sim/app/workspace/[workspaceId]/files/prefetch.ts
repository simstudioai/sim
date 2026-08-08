import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace'
import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import {
  WORKSPACE_FILE_FOLDERS_STALE_TIME,
  workspaceFileFolderKeys,
} from '@/hooks/queries/workspace-file-folders'
import {
  WORKSPACE_FILES_LIST_STALE_TIME,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

/**
 * Prefetches everything the Files browser needs to paint a complete, correctly-ordered
 * first frame: workspace files, file folders, and (via {@link prefetchResourceListChrome})
 * the pinned ids that drive row order plus the members behind the Owner column —
 * under the same query keys their client hooks (`useWorkspaceFiles`,
 * `useWorkspaceFileFolders`) use (scope `active`), so the browser paints populated
 * on first render.
 *
 * Calls the data layer directly — the same functions the API routes use — matching
 * `prefetchWorkspaceSidebar`. A rejection here is swallowed by `prefetchQuery` and the
 * errored entry dropped by `shouldDehydrateQuery`, so one list failing must not take
 * its siblings down with it.
 *
 * Membership is verified once rather than per-list. Without access nothing is cached,
 * so the client fetch reaches the route and gets the real 403.
 */
export async function prefetchFilesBrowser(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: workspaceFilesKeys.list(workspaceId, 'active'),
      queryFn: () => listWorkspaceFilesWithShares(workspaceId, 'active'),
      staleTime: WORKSPACE_FILES_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: workspaceFileFolderKeys.list(workspaceId, 'active'),
      queryFn: () => listWorkspaceFileFolders(workspaceId, { scope: 'active' }),
      staleTime: WORKSPACE_FILE_FOLDERS_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, userId, 'file'),
  ])
}
