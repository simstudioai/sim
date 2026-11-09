import 'server-only'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
import { listSearchHistoryContract } from '@/lib/api/contracts/knowledge/search-history'
import { listSearchHistory } from '@/lib/knowledge/application/search-history'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  SEARCH_HISTORY_STALE_TIME,
  searchHistoryKeys,
} from '@/hooks/queries/utils/search-history-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  asRouteResponse,
  readSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/**
 * The viewer's Search history, for a viewer Search would serve. Results stay on the client. The
 * history's key names the viewer, so with no session to name one the read gives up its seat.
 */
export async function seedSearchHistory(
  queryClient: QueryClient,
  { organization, searchAccess }: PlatformOrganization
): Promise<void> {
  if (!searchAccess.memberScoped) return
  const viewer = await readSessionViewer()
  if (!viewer) return
  const { principal } = viewer
  await queryClient.prefetchQuery({
    queryKey: searchHistoryKeys.list(organization.id, principal.userId),
    queryFn: () =>
      withinPrefetchBudget(async () =>
        asRouteResponse(
          listSearchHistoryContract,
          await listSearchHistory.execute({ principal, input: { organizationId: organization.id } })
        )
      ),
    staleTime: SEARCH_HISTORY_STALE_TIME,
  })
}

/** The history under Search's field. */
export async function prefetchSearch(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await seedSearchHistory(queryClient, organization)
  return dehydrate(queryClient)
}
