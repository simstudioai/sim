import type { QueryClient } from '@tanstack/react-query'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { FOLDER_LIST_STALE_TIME, folderKeys, mapFolder } from '@/hooks/queries/utils/folder-keys'
import {
  WORKSPACE_FILES_LIST_STALE_TIME,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

/**
 * Prefetches the home page's secondary lists — folders and workspace files —
 * under the same query keys their client hooks (`useFolders`,
 * `useWorkspaceFiles`) use, so the home view paints populated on first render.
 *
 * The workflow list (`workflowKeys.list(ws, 'active')`) is already hydrated by
 * the workspace sidebar prefetch and is intentionally not repeated here.
 *
 * Folders are mapped with the same `mapFolder` the hook applies, and files go through the
 * same `listWorkspaceFilesWithShares` the Files browser and the route use, so the hydrated
 * entry matches a client fetch exactly.
 */
export async function prefetchHomeLists(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'active', 'workflow'),
      queryFn: async () => {
        const folders = await listFoldersForWorkspace(workspaceId, 'active', 'workflow')
        return folders.map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: workspaceFilesKeys.list(workspaceId, 'active'),
      queryFn: () => listWorkspaceFilesWithShares(workspaceId, 'active'),
      staleTime: WORKSPACE_FILES_LIST_STALE_TIME,
    }),
  ])
}
