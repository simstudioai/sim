import type { QueryClient } from '@tanstack/react-query'
import type { FolderApi } from '@/lib/api/contracts'
import type { ListWorkspaceFilesResponse } from '@/lib/api/contracts/workspace-files'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
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
 * Folders are fetched through the route and mapped with the same `mapFolder`
 * the hook applies, matching its cached shape (string dates → `Date`). Files
 * carry `Date` fields, so they go through the route and cache the serialized
 * wire shape — see {@link prefetchInternalJson}.
 */
export async function prefetchHomeLists(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'workflow', 'active'),
      queryFn: async () => {
        const { folders } = await prefetchInternalJson<{ folders?: FolderApi[] }>(
          `/api/folders?workspaceId=${workspaceId}&resourceType=workflow&scope=active`
        )
        return (folders ?? []).map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
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
  ])
}
