import { useInfiniteQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { listProjectsContract } from '@/lib/api/contracts/projects'

const PROJECT_LIST_STALE_TIME = 30_000
const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (organizationId?: string) => [...projectKeys.lists(), organizationId ?? null] as const,
}

export function useProjects(organizationId?: string, options?: { enabled?: boolean }) {
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
      !(isApiClientError(error) && error.status === 503) && failureCount < 3,
    enabled: organizationId !== '' && (options?.enabled ?? true),
  })
}
