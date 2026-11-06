import { type QueryClient, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getProjectFileContract } from '@/lib/api/contracts/project-files'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import { projectListKeys, useProjectList } from '@/hooks/queries/project-list'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-keys'

const PROJECT_FILE_STALE_TIME = 30_000
const projectKeys = {
  all: projectListKeys.all,
  files: () => [...projectKeys.all, 'file'] as const,
  file: (projectId: string, fileId: string) => [...projectKeys.files(), projectId, fileId] as const,
}

/** Lists the caller's Projects; never requests while the `projects` rollout flag is off. */
export function useProjects(organizationId: string) {
  return useProjectList(organizationId, useFeatureFlag('projects'))
}

/** One Project file's record; never requests while the `projects` rollout flag is off. */
export function useProjectFile(projectId: string, fileId: string) {
  const projectsEnabled = useFeatureFlag('projects')
  return useQuery({
    queryKey: projectKeys.file(projectId, fileId),
    queryFn: async ({ signal }) => {
      const { file } = await requestJson(getProjectFileContract, {
        params: { id: projectId, fileId },
        signal,
      })
      return file
    },
    staleTime: PROJECT_FILE_STALE_TIME,
    enabled: projectsEnabled && Boolean(projectId) && Boolean(fileId),
  })
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
