import 'server-only'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
import { listSearchHistoryContract } from '@/lib/api/contracts/knowledge/search-history'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  SEARCH_HISTORY_STALE_TIME,
  searchHistoryKeys,
} from '@/hooks/queries/utils/search-history-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { prefetchRequestJson } from '@/platform/lib/data/server-request'

/** The viewer's Search history, for a viewer Search would serve. Results stay on the client. */
export async function seedSearchHistory(
  queryClient: QueryClient,
  { organization, searchAccess, viewer }: PlatformOrganization
): Promise<void> {
  if (!searchAccess.memberScoped) return
  await queryClient.prefetchQuery({
    queryKey: searchHistoryKeys.list(organization.id, viewer.userId),
    queryFn: () =>
      prefetchRequestJson(listSearchHistoryContract, { params: { id: organization.id } }),
    staleTime: SEARCH_HISTORY_STALE_TIME,
  })
}

/** The history under Search's field. */
export async function prefetchSearch(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await seedSearchHistory(queryClient, organization)
  return dehydrate(queryClient)
}
