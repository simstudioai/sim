import { updateForkExcludedWorkflowsContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { updateWorkspaceForkExclusions } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const PUT = defineInternalJsonRoute({
  contract: updateForkExcludedWorkflowsContract,
  auth: internalSessionAuth,
  operation: forkOperations.exclusions,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: updateWorkspaceForkExclusions,
  present: (result) => result,
})
