import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type MentionFamily,
  searchOrganizationMentionsContract,
} from '@/lib/api/contracts/organization-mentions'

/** Short: a resource created elsewhere should reach the picker on its next opening. */
const ORGANIZATION_MENTIONS_STALE_TIME = 10 * 1000

export interface MentionRequest {
  query: string
  workspaceId?: string
  family?: MentionFamily
  folderId?: string
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
      request.workspaceId ?? '',
      request.family ?? '',
      request.folderId ?? '',
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

/** The browsed workspaces' families and first rows, read as each workspace is opened. */
export function useOrganizationMentionBrowse(
  organizationId: string,
  workspaceIds: readonly string[],
  limit: number
) {
  return useQueries({
    queries: workspaceIds.map((workspaceId) =>
      mentionQueryOptions(organizationId, { query: '', workspaceId, limit }, true)
    ),
  })
}
