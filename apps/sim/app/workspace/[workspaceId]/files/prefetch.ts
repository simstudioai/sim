import type { QueryClient } from '@tanstack/react-query'
import type { FolderApi } from '@/lib/api/contracts/folders'
import type { ListWorkspaceFilesResponse } from '@/lib/api/contracts/workspace-files'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import {
  WORKSPACE_FILES_LIST_STALE_TIME,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

/**
 * Prefetches the Files browser's two lists — workspace files and file folders —
 * under the same query keys their client hooks (`useWorkspaceFiles`,
 * `useFolders(workspaceId, { resourceType: 'file' })`) use (scope `active`), so
 * the browser paints populated on first render.
 *
 * Both payloads carry `Date` fields, so they go through their routes and cache
 * the serialized wire shape — see {@link prefetchInternalJson}.
 */
export async function prefetchFilesBrowser(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: workspaceFilesKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const data = await prefetchInternalJson<ListWorkspaceFilesResponse>(
          `/api/workspaces/${workspaceId}/files?scope=active`
        )
        return data.success ? data.files : []
      },
      staleTime: WORKSPACE_FILES_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'file', 'active'),
      queryFn: async () => {
        const data = await prefetchInternalJson<{ folders?: FolderApi[] }>(
          `/api/folders?workspaceId=${workspaceId}&resourceType=file&scope=active`
        )
        return (data.folders ?? []).map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
  ])
}
