import { forkWorkspaceContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkWorkspace } from '@/ee/workspace-forking/application/create-and-sync'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const POST = defineInternalJsonRoute({
  contract: forkWorkspaceContract,
  auth: internalSessionAuth,
  operation: forkOperations.create,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: forkWorkspace,
  present: (result) => ({ workspace: result.workspace, workflowsCopied: result.workflowsCopied }),
})
