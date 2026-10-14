import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { listProjectsContract, type Project } from '@/lib/api/contracts/projects'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

const PROJECT_LIST_STALE_TIME = 30_000
const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (organizationId?: string) => [...projectKeys.lists(), organizationId ?? null] as const,
  inventory: (organizationId?: string) =>
    [...projectKeys.lists(), organizationId ?? null, 'inventory'] as const,
}

/**
 * Lists the caller's Projects, across organizations when `organizationId` is omitted.
 * Never requests while the `projects` rollout flag is off.
 */
export function useProjects(organizationId?: string, options?: { enabled?: boolean }) {
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
    enabled: projectsEnabled && organizationId !== '' && (options?.enabled ?? true),
  })
}

/** Complete authorized Project hierarchy for organization resource pickers. */
export function useProjectInventory(organizationId?: string, enabled = true) {
  const projectsEnabled = useFeatureFlag('projects')
  return useQuery({
    queryKey: projectKeys.inventory(organizationId),
    queryFn: async ({ signal }) => {
      const projects: Project[] = []
      let cursor: string | undefined
      do {
        const page = await requestJson(listProjectsContract, {
          query: { organizationId, cursor, limit: 100 },
          signal,
        })
        projects.push(...page.projects)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return projects
    },
    enabled: projectsEnabled && Boolean(organizationId) && enabled,
    staleTime: PROJECT_LIST_STALE_TIME,
    retry: false,
  })
}
