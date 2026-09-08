import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2DeployWorkflowContract,
  v2UndeployWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { captureServerEvent } from '@/lib/posthog/server'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = defineV2JsonRoute({
  contract: v2DeployWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.deploy,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  parseOptions: {
    optionalJsonBody: true,
  },
  mapInput: ({ params, body }) => ({
    workflowId: params.workflowId,
    name: body.name,
    description: body.description ?? undefined,
    requestId: generateRequestId(),
  }),
  useCase: deployWorkflow,
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

export const DELETE = defineV2JsonRoute({
  contract: v2UndeployWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.undeploy,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId, requestId: generateRequestId() }),
  useCase: undeployWorkflow,
  present: (result) => ({
    data: {
      id: result.workflowId,
      isDeployed: false,
      deployedAt: null,
      warnings: result.warnings ?? [],
      activeDeployment: null,
      latestDeploymentAttempt: null,
    },
  }),
  /**
   * Telemetry only. `workflowOperations.undeploy` denies a workspace API key at
   * admission, so a non-personal principal cannot reach here — and this hook runs
   * after the undeploy has already committed, so asserting the invariant here
   * would report a succeeded undeploy as a 500 rather than catching anything.
   */
  onSuccess: ({ principal, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'workflow_undeployed',
      { workflow_id: result.workflowId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
