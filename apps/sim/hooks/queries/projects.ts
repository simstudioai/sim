import type { QueryClient } from '@tanstack/react-query'
import { projectListKeys } from '@/hooks/queries/project-list'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-keys'

const projectKeys = {
  all: projectListKeys.all,
  files: () => [...projectKeys.all, 'file'] as const,
  file: (projectId: string, fileId: string) => [...projectKeys.files(), projectId, fileId] as const,
}

/**
 * Refetches an open Project file view after the agent changes the file: its record, and the bytes
 * the file viewer caches under the Project id it uses in place of a workspace id.
 */
export function invalidateProjectFileQueries(
  queryClient: QueryClient,
  projectId: string,
  fileId: string
): void {
  void queryClient.invalidateQueries({ queryKey: projectKeys.file(projectId, fileId) })
  void queryClient.invalidateQueries({
    queryKey: workspaceFilesKeys.contentFile(projectId, fileId),
  })
}
