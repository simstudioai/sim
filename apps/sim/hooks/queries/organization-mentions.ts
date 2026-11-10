import { useEffect } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type MentionListFamily,
  searchOrganizationMentionsContract,
} from '@/lib/api/contracts/organization-mentions'

/** Short: a resource created elsewhere should reach the picker on its next opening. */
const ORGANIZATION_MENTIONS_STALE_TIME = 10 * 1000

interface MentionRequest {
  query: string
  family?: MentionListFamily
  limit: number
}

const organizationMentionKeys = {
  all: ['organization-mentions'] as const,
  searches: () => [...organizationMentionKeys.all, 'search'] as const,
  search: (organizationId: string, request: MentionRequest) =>
    [
      ...organizationMentionKeys.searches(),
      organizationId,
      request.query,
      request.family ?? '',
      request.limit,
    ] as const,
}

function mentionQueryOptions(organizationId: string, request: MentionRequest, enabled: boolean) {
  return {
    queryKey: organizationMentionKeys.search(organizationId, request),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      requestJson(searchOrganizationMentionsContract, {
        params: { id: organizationId },
        query: request,
        signal,
      }),
    enabled: enabled && Boolean(organizationId),
    staleTime: ORGANIZATION_MENTIONS_STALE_TIME,
  }
}

/** One mention read: an `@` query's matches, the organization's workspaces, or every skill. */
export function useOrganizationMentions(
  organizationId: string,
  request: MentionRequest,
  options: { enabled: boolean }
) {
  return useQuery({
    ...mentionQueryOptions(organizationId, request, options.enabled),
    placeholderData: keepPreviousData,
  })
}

/**
 * Marks every mention read stale after any mutation in this tab succeeds, so a resource just
 * created, renamed or deleted is listed as it now is the next time a picker reads.
 */
export function useMentionsFollowMutations() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success')
          void queryClient.invalidateQueries({ queryKey: organizationMentionKeys.all })
      }),
    [queryClient]
  )
}
