import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
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
 * `useWorkspaceFileFolders`) use (scope `active`), so the browser paints
 * populated on first render.
 *
 * Files and folders read the data layer; both payloads are shaped to their route contract so
 * a hydrated entry matches a client fetch. Everything else still goes through its route —
 * see {@link prefetchInternalJson}.
 *
 * Those two reads carry no authorization of their own, so the viewer is proved first. This
 * reuses the layout's `cache`d host-context lookup rather than re-deriving the permission,
 * so it costs no additional queries; a viewer without access caches nothing and the client
 * fetch reaches the route for the real 403.
 */
export async function prefetchFilesBrowser(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

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
    prefetchResourceListChrome(queryClient, workspaceId, 'file'),
  ])
}
