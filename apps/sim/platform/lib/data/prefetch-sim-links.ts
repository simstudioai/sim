import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listSimLinksContract } from '@/lib/api/contracts/sim-links'
import { presentSimLinkPage } from '@/lib/api/server/sim-link-presenters'
import { listSimLinks } from '@/lib/sim-links/application/use-cases'
import { loadSimLinksListView } from '@/lib/sim-links/search-params'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { SIM_LINKS_STALE_TIME, simLinkKeys } from '@/hooks/queries/utils/sim-link-keys'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The first page of the list this URL asks for. Later pages load as the table scrolls. */
export async function prefetchSimLinks(
  organizationId: string,
  query: Record<string, string | string[] | undefined>
): Promise<DehydratedState> {
  const { search, sort, dir } = loadSimLinksListView(query)
  const term = search.trim()
  const queryClient = makeQueryClient()
  await queryClient.prefetchInfiniteQuery({
    queryKey: simLinkKeys.list(organizationId, term, sort, dir),
    initialPageParam: undefined as string | undefined,
    queryFn: () =>
      withinPrefetchBudget(async () => {
        const { principal } = await requireSessionViewer()
        return asRouteResponse(
          listSimLinksContract,
          presentSimLinkPage(
            await listSimLinks.execute({
              principal,
              input: { organizationId, search: term || undefined, sort, dir },
            })
          )
        )
      }),
    staleTime: SIM_LINKS_STALE_TIME,
  })
  return dehydrate(queryClient)
}
