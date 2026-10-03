import { v2ActivateWorkflowVersionContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { activateWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/v2/workflows/[workflowId]/versions/[version]/activate — promote a version to live.
 *
 * The same application operation as rollback, under a different transition.
 * They stay separate paths because the two mean opposite things to a caller —
 * rollback selects the version preceding the active one and refuses when
 * nothing is deployed, while activation names its target and works from any
 * state — and a single endpoint whose direction depended on whether `version`
 * was supplied would make the destructive reading the default one.
 */
export const POST = defineV2JsonRoute({
  contract: v2ActivateWorkflowVersionContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.activateVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  parseOptions: {
    optionalJsonBody: true,
  },
  mapInput: ({ params }) => ({
    workflowId: params.workflowId,
    version: params.version,
    transition: 'activate' as const,
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
