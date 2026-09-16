import { getForkAvailabilityContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { getWorkspaceForkAvailability } from '@/ee/workspace-forking/application/discovery'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getForkAvailabilityContract,
  auth: internalSessionAuth,
  operation: forkOperations.discover,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getWorkspaceForkAvailability,
  present: (result) => result,
})
