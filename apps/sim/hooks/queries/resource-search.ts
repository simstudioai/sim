import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ResourceSearchType,
  searchOrganizationResourcesContract,
} from '@/lib/api/contracts/resource-search'

const RESOURCE_SEARCH_STALE_TIME = 30_000

interface OrganizationResourceSearch {
  query: string
  types: readonly ResourceSearchType[]
  workspaceIds: readonly string[]
}

const resourceSearchKeys = {
  all: ['resource-search'] as const,
  organizations: () => [...resourceSearchKeys.all, 'organization'] as const,
  organization: (
    organizationId: string,
    { query, types, workspaceIds }: OrganizationResourceSearch
  ) =>
    [
      ...resourceSearchKeys.organizations(),
      organizationId,
      query,
      [...types].sort().join(','),
      [...workspaceIds].sort().join(','),
    ] as const,
}

/**
 * Resources named like `query`, narrowed by type and workspace, across the organization's
 * workspaces the viewer can open, a page at a time. Keeps the previous results while the next
 * search loads, so typing does not flash an empty list.
 */
export function useOrganizationResourceSearch(
  organizationId: string,
  search: OrganizationResourceSearch,
  options: { enabled: boolean }
) {
  return useInfiniteQuery({
    queryKey: resourceSearchKeys.organization(organizationId, search),
    queryFn: ({ pageParam, signal }) =>
      requestJson(searchOrganizationResourcesContract, {
        params: { id: organizationId },
        query: {
          q: search.query || undefined,
          types: search.types.length ? [...search.types] : undefined,
          workspaceIds: search.workspaceIds.length ? [...search.workspaceIds] : undefined,
          cursor: pageParam,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(organizationId) && options.enabled,
    staleTime: RESOURCE_SEARCH_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
