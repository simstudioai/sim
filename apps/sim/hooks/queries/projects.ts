import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  archiveProjectContract,
  getWorkspaceProjectContract,
  listProjectsContract,
  renameProjectContract,
} from '@/lib/api/contracts/projects'
import { projectKeys } from '@/hooks/queries/utils/project-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'

const PROJECT_LIST_STALE_TIME = 30_000
const PROJECT_DETAIL_STALE_TIME = 30_000
/** The list endpoint's page ceiling; reading every project walks the cursor in pages this size. */
const PROJECT_PAGE_LIMIT = 100

export function useProjects(organizationId: string) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listProjectsContract, {
        query: { organizationId, cursor: pageParam ?? undefined, limit: PROJECT_PAGE_LIMIT },
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
    enabled: Boolean(organizationId),
  })
}

async function fetchAllProjects(organizationId: string, signal: AbortSignal) {
  const projects = []
  let cursor: string | undefined
  do {
    const page = await requestJson(listProjectsContract, {
      query: { organizationId, cursor, limit: PROJECT_PAGE_LIMIT },
      signal,
    })
    projects.push(...page.projects)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return projects
}

/** Every active project in the organization the viewer can see, for surfaces that list them all. */
export function useOrganizationProjects(organizationId: string) {
  return useQuery({
    queryKey: projectKeys.complete(organizationId),
    queryFn: ({ signal }) => fetchAllProjects(organizationId, signal),
    staleTime: PROJECT_LIST_STALE_TIME,
    enabled: Boolean(organizationId),
  })
}

/** The project a workspace is an environment of. */
export function useWorkspaceProject(workspaceId: string) {
  return useQuery({
    queryKey: projectKeys.byWorkspace(workspaceId),
    queryFn: async ({ signal }) => {
      const { project } = await requestJson(getWorkspaceProjectContract, {
        params: { workspaceId },
        signal,
      })
      return project
    },
    staleTime: PROJECT_DETAIL_STALE_TIME,
    enabled: Boolean(workspaceId),
  })
}

export function useRenameProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { projectId: string; name: string }) =>
      requestJson(renameProjectContract, {
        params: { id: vars.projectId },
        body: { name: vars.name },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

/** Archives the project with every environment in it. */
export function useArchiveProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { projectId: string }) =>
      requestJson(archiveProjectContract, { params: { id: vars.projectId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}
