import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import {
  WORKSPACE_FILE_FOLDERS_STALE_TIME,
  workspaceFileFolderKeys,
} from '@/hooks/queries/workspace-file-folders'

/**
 * Prefetches what the Files browser needs on top of the workspace layout's own prefetch, so the
 * first frame is complete and correctly ordered: file folders, and (via
 * {@link prefetchResourceListChrome}) the pinned ids that drive row order plus the members behind
 * the Owner column — under the same query keys their client hooks (`useWorkspaceFileFolders`) use
 * (scope `active`), so the browser paints populated on first render.
 *
 * The FILE LIST itself is deliberately not here: the sidebar reads it on every workspace route, so
 * it is prefetched by `prefetchWorkspaceSidebar` in the layout — the only boundary that renders
 * before the sidebar registers the query. Prefetching it again here would re-read it per request
 * and still not reach the server render (`HydrationBoundary` defers an already-seen query to an
 * effect, which SSR never runs). See the note on that entry.
 *
 * Folders and the chrome reads all go through the data layer, shaped to their route contracts so a
 * hydrated entry matches a client fetch.
 *
 * That read carries no authorization of its own, so the viewer is proved first. This reuses the
 * layout's `cache`d host-context lookup rather than re-deriving the permission, so it costs no
 * additional queries; a viewer without access caches nothing and the client fetch reaches the
 * route for the real 403.
 */
export async function prefetchFilesBrowser(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) return
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: workspaceFileFolderKeys.list(workspaceId, 'active'),
      queryFn: () => listWorkspaceFileFolders(workspaceId, { scope: 'active' }),
      staleTime: WORKSPACE_FILE_FOLDERS_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, 'file', userId),
  ])
}
