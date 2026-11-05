import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationRosterContract } from '@/lib/api/contracts/organization'
import {
  ORGANIZATION_ROSTER_STALE_TIME,
  organizationKeys,
} from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { prefetchSignal, serverRequestJson } from '@/platform/lib/data/server-request'

/** The roster the legacy settings warmer loads on intent, under the client hook's key. */
export async function prefetchRoster(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: organizationKeys.roster(organizationId),
    queryFn: async () => {
      const { data } = await serverRequestJson(getOrganizationRosterContract, {
        params: { id: organizationId },
        signal: prefetchSignal(),
      })
      return data
    },
    staleTime: ORGANIZATION_ROSTER_STALE_TIME,
  })
  return dehydrate(queryClient)
}
