import 'server-only'
import { createLogger } from '@sim/logger'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationRosterContract } from '@/lib/api/contracts/organization'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { serverRequestJson } from '@/platform/lib/data/server-request'

const logger = createLogger('PlatformMembersPrefetch')

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

/** The roster the legacy settings warmer loads on intent, under the client hook's key. */
export async function prefetchRoster(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  try {
    const { data } = await serverRequestJson(getOrganizationRosterContract, {
      params: { id: organizationId },
      signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    })
    queryClient.setQueryData(organizationKeys.roster(organizationId), data)
  } catch (error) {
    logger.warn('Roster prefetch failed; client will fetch', { error })
  }
  return dehydrate(queryClient)
}
