import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFileFoldersContract } from '@/lib/api/contracts/workspace-file-folders'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import { seedWorkspaceFiles } from '@/app/workspace/[workspaceId]/lib/seed-workspace-files'
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
 * The file list is seeded here rather than in the layout so only the routes that render it pay for
 * it. See {@link seedWorkspaceFiles} for why a large workspace seeds nothing at all.
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
      /**
       * Parsed through the route's own response schema rather than seeded raw. The
       * manager's record type and `workspaceFileFolderSchema` are two independent
       * declarations that happen to agree today; without this parse, adding a column
       * to one silently seeds a shape a client fetch would have stripped — the exact
       * divergence that put ISO strings under `workspaceFilesKeys.list`.
       */
      queryFn: async () => {
        const folders = await listWorkspaceFileFolders(workspaceId, { scope: 'active' })
        return listWorkspaceFileFoldersContract.response.schema.shape.folders.parse(folders)
      },
      staleTime: WORKSPACE_FILE_FOLDERS_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, 'file', userId),
    seedWorkspaceFiles(queryClient, workspaceId),
  ])
}
