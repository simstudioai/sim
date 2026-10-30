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

const SIM_LINKS_STALE_TIME = 30 * 1000

const simLinkKeys = {
  all: ['sim-links'] as const,
  lists: (organizationId: string) => [...simLinkKeys.all, 'list', organizationId] as const,
  list: (organizationId: string, search: string) =>
    [...simLinkKeys.lists(organizationId), search] as const,
}

export function useSimLinks(organizationId: string, search: string) {
  return useInfiniteQuery({
    queryKey: simLinkKeys.list(organizationId, search),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listSimLinksContract, {
        params: { id: organizationId },
        query: { search: search || undefined, cursor: pageParam },
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

/** Creates a link, or replaces the fields of `linkId` when given. */
export function useSaveSimLink(organizationId: string) {
  const invalidate = useInvalidateSimLinks(organizationId)
  return useMutation({
    mutationFn: ({ linkId, body }: { linkId?: string; body: SimLinkBody }) =>
      linkId
        ? requestJson(updateSimLinkContract, { params: { id: organizationId, linkId }, body })
        : requestJson(createSimLinkContract, { params: { id: organizationId }, body }),
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
