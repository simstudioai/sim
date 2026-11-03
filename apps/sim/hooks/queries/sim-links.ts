import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
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

const SIM_LINKS_STALE_TIME = 30 * 1000

const simLinkKeys = {
  all: ['sim-links'] as const,
  lists: (organizationId: string) => [...simLinkKeys.all, 'list', organizationId] as const,
  list: (organizationId: string, search: string, sort: SimLinkSort, dir: SortDirection) =>
    [...simLinkKeys.lists(organizationId), search, sort, dir] as const,
}

export function useSimLinks(
  organizationId: string,
  search: string,
  sort: SimLinkSort,
  dir: SortDirection
) {
  return useInfiniteQuery({
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
    placeholderData: keepPreviousData,
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
