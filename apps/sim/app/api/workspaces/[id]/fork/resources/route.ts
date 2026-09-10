import { getForkResourcesContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { getWorkspaceForkResourceDetails } from '@/ee/workspace-forking/application/resource-details'

export const GET = defineInternalJsonRoute({
  contract: getForkResourcesContract,
  auth: internalSessionAuth,
  operation: forkOperations.discover,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getWorkspaceForkResourceDetails,
  present: (result) => result,
})
