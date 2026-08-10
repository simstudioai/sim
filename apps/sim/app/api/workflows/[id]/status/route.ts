import { getWorkflowStatusContract } from '@/lib/api/contracts/workflows'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { createInternalWorkflowErrorPolicy, internalWorkflowReadAuth } from '@/lib/workflows/api'
import { readWorkflowDeploymentStatus } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getWorkflowStatusContract,
  auth: internalWorkflowReadAuth,
  operation: workflowOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Workflow status retains its existing authenticated admission policy.',
  }),
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to get status'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: readWorkflowDeploymentStatus,
  present: (result) => ({
    isDeployed: result.isDeployed,
    deployedAt: result.activeDeployment?.deployedAt
      ? new Date(result.activeDeployment.deployedAt)
      : result.workflow.deployedAt,
    needsRedeployment: result.needsRedeployment,
  }),
})
