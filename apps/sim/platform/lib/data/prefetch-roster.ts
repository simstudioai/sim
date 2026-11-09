import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationRosterContract } from '@/lib/api/contracts/organization'
import { readOrganizationRoster } from '@/lib/organizations/application/member-roster'
import {
  ORGANIZATION_ROSTER_STALE_TIME,
  organizationKeys,
} from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The roster the legacy settings warmer loads on intent, under the client hook's key. */
export async function prefetchRoster(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: organizationKeys.roster(organizationId),
    queryFn: () =>
      withinPrefetchBudget(async () => {
        const { principal } = await requireSessionViewer()
        const { data } = await asRouteResponse(getOrganizationRosterContract, {
          success: true,
          data: await readOrganizationRoster.execute({ principal, input: { organizationId } }),
        })
        return data
      }),
    staleTime: ORGANIZATION_ROSTER_STALE_TIME,
  })
  return dehydrate(queryClient)
}
