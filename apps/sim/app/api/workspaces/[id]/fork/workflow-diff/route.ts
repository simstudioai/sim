import { getForkWorkflowDiffContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { getWorkspaceSyncWorkflowDiff } from '@/ee/workspace-forking/application/sync-workflow-diff'

export const GET = defineInternalJsonRoute({
  contract: getForkWorkflowDiffContract,
  auth: internalSessionAuth,
  operation: forkOperations.syncPreview,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, ...query }),
  useCase: getWorkspaceSyncWorkflowDiff,
  present: (result) => result,
})
