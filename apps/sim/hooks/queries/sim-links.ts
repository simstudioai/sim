import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createSimLinkContract,
  deleteSimLinkContract,
  listSimLinksContract,
  type SimLinkBody,
  updateSimLinkContract,
} from '@/lib/api/contracts/sim-links'
import type { SimLinkSort } from '@/lib/sim-links/validation'
import type { SortDirection } from '@/lib/url-state'
import { SIM_LINKS_STALE_TIME, simLinkKeys } from '@/hooks/queries/utils/sim-link-keys'

function simLinksQueryOptions(
  organizationId: string,
  search: string,
  sort: SimLinkSort,
  dir: SortDirection
) {
  return infiniteQueryOptions({
    queryKey: simLinkKeys.list(organizationId, search, sort, dir),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listSimLinksContract, {
        params: { id: organizationId },
        query: { search: search || undefined, cursor: pageParam, sort, dir },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: SIM_LINKS_STALE_TIME,
  })
}

export function useSimLinks(
  organizationId: string,
  search: string,
  sort: SimLinkSort,
  dir: SortDirection
) {
  return useInfiniteQuery({
    ...simLinksQueryOptions(organizationId, search, sort, dir),
    placeholderData: keepPreviousData,
  })
}

/**
 * Links whose destination is exactly `url`. Shares the list key prefix, so creating a link
 * refreshes it.
 */
export function useSimLinksForUrl(organizationId: string, url: string, enabled = true) {
  return useQuery({
    queryKey: simLinkKeys.forUrl(organizationId, url),
    queryFn: ({ signal }) =>
      requestJson(listSimLinksContract, {
        params: { id: organizationId },
        query: { url },
        signal,
      }),
    select: (page) => page.links,
    staleTime: SIM_LINKS_STALE_TIME,
    enabled: Boolean(organizationId) && enabled,
  })
}

function useInvalidateSimLinks(organizationId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: simLinkKeys.lists(organizationId) })
}

export function useCreateSimLink(organizationId: string) {
  const invalidate = useInvalidateSimLinks(organizationId)
  return useMutation({
    mutationFn: (body: SimLinkBody) =>
      requestJson(createSimLinkContract, { params: { id: organizationId }, body }),
    onSuccess: invalidate,
  })
}

export function useUpdateSimLink(organizationId: string) {
  const invalidate = useInvalidateSimLinks(organizationId)
  return useMutation({
    mutationFn: ({ linkId, body }: { linkId: string; body: SimLinkBody }) =>
      requestJson(updateSimLinkContract, { params: { id: organizationId, linkId }, body }),
    onSuccess: invalidate,
  })
}

export function useDeleteSimLink(organizationId: string) {
  const invalidate = useInvalidateSimLinks(organizationId)
  return useMutation({
    mutationFn: (linkId: string) =>
      requestJson(deleteSimLinkContract, { params: { id: organizationId, linkId } }),
    onSuccess: invalidate,
  })
}
