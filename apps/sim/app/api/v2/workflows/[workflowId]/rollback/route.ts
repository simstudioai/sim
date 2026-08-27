import { v2RollbackWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { activateWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = defineV2JsonRoute({
  contract: v2RollbackWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.activateVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  parseOptions: {
    optionalJsonBody: true,
  },
  mapInput: ({ params, body }) => ({
    workflowId: params.workflowId,
    version: body.version,
    transition: 'rollback' as const,
    requestId: generateRequestId(),
  }),
  useCase: activateWorkflowVersion,
  present: (result) => ({
    data: {
      id: result.workflowId,
      isDeployed: Boolean(result.activeDeployment),
      deployedAt: result.deployedAt?.toISOString() ?? null,
      version: result.version,
      warnings: result.warnings ?? [],
      activeDeployment: result.activeDeployment ?? null,
      latestDeploymentAttempt: result.latestDeploymentAttempt ?? null,
    },
  }),
})
