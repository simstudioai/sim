import {
  getForkMappingContract,
  updateForkMappingContract,
} from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { getWorkspaceForkMappingDetails } from '@/ee/workspace-forking/application/mapping-details'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { updateWorkspaceForkMappings } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const GET = defineInternalJsonRoute({
  contract: getForkMappingContract,
  auth: internalSessionAuth,
  operation: forkOperations.mappingsRead,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, ...query }),
  useCase: getWorkspaceForkMappingDetails,
  present: (result) => result,
})
export const PUT = defineInternalJsonRoute({
  contract: updateForkMappingContract,
  auth: internalSessionAuth,
  operation: forkOperations.mappingsUpdate,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    otherWorkspaceId: body.otherWorkspaceId,
    direction: body.direction,
    mappings: body.entries,
    dependentValues: body.dependentValues,
  }),
  useCase: updateWorkspaceForkMappings,
  present: (result) => ({ success: true as const, ...result }),
})
