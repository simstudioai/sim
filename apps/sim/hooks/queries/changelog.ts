import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listChangelogReleasesContract,
  type UpdateChangelogReleaseBody,
  updateChangelogReleaseContract,
} from '@/lib/api/contracts/changelog'

const CHANGELOG_STALE_TIME = 30_000

const changelogKeys = {
  all: ['changelog'] as const,
  lists: () => [...changelogKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...changelogKeys.lists(), workspaceId] as const,
}

/** Releases newest first, a page at a time. */
export function useChangelogReleases(workspaceId: string) {
  return useInfiniteQuery({
    queryKey: changelogKeys.list(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      requestJson(listChangelogReleasesContract, {
        params: { id: workspaceId },
        query: pageParam ? { cursor: pageParam } : {},
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
    staleTime: CHANGELOG_STALE_TIME,
  })
}

interface UpdateChangelogReleaseVariables extends UpdateChangelogReleaseBody {
  releaseId: string
}

export function useUpdateChangelogRelease(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ releaseId, ...body }: UpdateChangelogReleaseVariables) =>
      requestJson(updateChangelogReleaseContract, {
        params: { id: workspaceId, releaseId },
        body,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: changelogKeys.list(workspaceId) }),
  })
}
