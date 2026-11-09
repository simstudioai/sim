import type { QueryClient } from '@tanstack/react-query'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-keys'

/**
 * Refetches an open Project file view after the agent changes the file: the bytes the file viewer
 * caches under the Project id it uses in place of a workspace id.
 */
export function invalidateProjectFileQueries(
  queryClient: QueryClient,
  projectId: string,
  fileId: string
): void {
  void queryClient.invalidateQueries({
    queryKey: workspaceFilesKeys.contentFile(projectId, fileId),
  })
}
