import { getForkLineageContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { getWorkspaceForkLineageDetails } from '@/ee/workspace-forking/application/lineage-details'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getForkLineageContract,
  auth: internalSessionAuth,
  operation: forkOperations.discover,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getWorkspaceForkLineageDetails,
  present: (result) => result,
})
