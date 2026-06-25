import type { QueryClient } from '@tanstack/react-query'
import type { WorkspaceFileFolderApi } from '@/lib/api/contracts/workspace-file-folders'
import type { ListWorkspaceFilesResponse } from '@/lib/api/contracts/workspace-files'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

/**
 * Prefetches the Files browser's two lists — workspace files and file folders —
 * under the same query keys their client hooks (`useWorkspaceFiles`,
 * `useWorkspaceFileFolders`) use (scope `active`), so the browser paints
 * populated on first render.
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
      staleTime: 30 * 1000,
    }),
    queryClient.prefetchQuery({
      queryKey: workspaceFileFolderKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const data = await prefetchInternalJson<{ folders?: WorkspaceFileFolderApi[] }>(
          `/api/workspaces/${workspaceId}/files/folders?scope=active`
        )
        return data.folders ?? []
      },
      staleTime: 30 * 1000,
    }),
  ])
}
