import { promoteForkContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { syncWorkspace } from '@/ee/workspace-forking/application/create-and-sync'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const POST = defineInternalJsonRoute({
  contract: promoteForkContract,
  auth: internalSessionAuth,
  operation: forkOperations.sync,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: syncWorkspace,
  present: (result) => ({
    promoteRunId: result.promoteRunId,
    updated: result.updated,
    created: result.created,
    archived: result.archived,
    redeployed: result.redeployed,
    deployFailed: result.deployFailed,
    deployWarnings: result.deployWarnings,
    unmappedRequired: result.unmappedRequired,
    blockers: result.blockers,
    needsConfiguration: result.needsConfiguration,
    clearedOptional: result.clearedOptional,
    droppedReferences: result.droppedReferences,
    triggerUrlChanges: result.triggerUrlChanges,
  }),
})
