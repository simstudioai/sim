import { revertToDeploymentVersionContract } from '@/lib/api/contracts/deployments'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'
import { revertWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineInternalJsonRoute({
  contract: revertToDeploymentVersionContract,
  operation: workflowOperations.revertVersion,
  useCase: revertWorkflowVersion,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI version reverts retain their existing admission policy.',
  }),
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to revert'),
  mapInput: ({ params }) => ({ workflowId: params.id, version: params.version }),
  present: (result) => ({
    message: 'Reverted to deployment version',
    lastSaved: result.lastSaved,
  }),
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'workflow_deployment_reverted',
      {
        workflow_id: result.workflowId,
        workspace_id: result.workspaceId,
        version: String(result.version),
      },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
