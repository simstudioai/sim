import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getProjectFileContract } from '@/lib/api/contracts/project-files'
import { listProjectsContract } from '@/lib/api/contracts/projects'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

const PROJECT_LIST_STALE_TIME = 30_000
const PROJECT_FILE_STALE_TIME = 30_000
const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (organizationId: string) => [...projectKeys.lists(), organizationId] as const,
  files: () => [...projectKeys.all, 'file'] as const,
  file: (projectId: string, fileId: string) => [...projectKeys.files(), projectId, fileId] as const,
}

/** Lists the caller's Projects; never requests while the `projects` rollout flag is off. */
export function useProjects(organizationId: string) {
  const projectsEnabled = useFeatureFlag('projects')
  return useInfiniteQuery({
    queryKey: projectKeys.list(organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listProjectsContract, {
        query: { organizationId, cursor: pageParam ?? undefined, limit: 100 },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: PROJECT_LIST_STALE_TIME,
    retry: (failureCount, error) =>
      failureCount < 1 &&
      (!isApiClientError(error) ||
        error.status === 408 ||
        error.status === 429 ||
        (error.status >= 500 && error.status !== 503)),
    enabled: projectsEnabled && Boolean(organizationId),
  })
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
