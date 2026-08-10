import {
  deployWorkflowContract,
  getDeploymentInfoContract,
  undeployWorkflowContract,
  updatePublicApiContract,
} from '@/lib/api/contracts/deployments'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { captureServerEvent } from '@/lib/posthog/server'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'
import {
  deployWorkflow,
  readWorkflowDeploymentStatus,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const NO_INTERNAL_RATE_LIMIT = internalRateLimits.none({
  reason:
    'Authenticated workspace UI deployment operations retain their existing admission policy.',
})

export const GET = defineInternalJsonRoute({
  contract: getDeploymentInfoContract,
  operation: workflowOperations.read,
  useCase: readWorkflowDeploymentStatus,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to fetch deployment information'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  present: (result) => {
    if (!result.isDeployed) {
      return {
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        needsRedeployment: false,
        isPublicApi: result.workflow.isPublicApi ?? false,
        activeDeployment: result.activeDeployment,
        latestDeploymentAttempt: result.latestDeploymentAttempt,
        warnings: result.warnings,
      }
    }
    return {
      apiKey: result.workflow.workspaceId ? 'Workspace API keys' : 'Personal API keys',
      isDeployed: true,
      deployedAt: result.activeDeployment?.deployedAt ?? result.workflow.deployedAt?.toISOString(),
      needsRedeployment: result.needsRedeployment,
      isPublicApi: result.workflow.isPublicApi ?? false,
      activeDeployment: result.activeDeployment,
      latestDeploymentAttempt: result.latestDeploymentAttempt,
      warnings: result.warnings,
    }
  },
})

export const POST = defineInternalJsonRoute({
  contract: deployWorkflowContract,
  operation: workflowOperations.deploy,
  useCase: deployWorkflow,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to deploy workflow'),
  mapInput: ({ params }) => ({ workflowId: params.id, requestId: generateRequestId() }),
  present: (result) => ({
    apiKey: 'Workspace API keys',
    isDeployed: Boolean(result.activeDeployment),
    deployedAt: result.deployedAt?.toISOString(),
    warnings: result.warnings,
    activeDeployment: result.activeDeployment,
    latestDeploymentAttempt: result.latestDeploymentAttempt,
  }),
})

export const PATCH = defineInternalJsonRoute({
  contract: updatePublicApiContract,
  operation: workflowOperations.updatePublicApi,
  useCase: updateWorkflowPublicApi,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to update deployment settings'),
  mapInput: ({ params, body }) => ({
    workflowId: params.id,
    isPublicApi: body.isPublicApi,
  }),
  present: (result) => ({ isPublicApi: result.isPublicApi }),
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'workflow_public_api_toggled',
      {
        workflow_id: result.workflowId,
        workspace_id: result.workspaceId,
        is_public: result.isPublicApi,
      },
      { groups: { workspace: result.workspaceId } }
    )
  },
})

export const DELETE = defineInternalJsonRoute({
  contract: undeployWorkflowContract,
  operation: workflowOperations.undeploy,
  useCase: undeployWorkflow,
  auth: internalSessionAuth,
  rateLimit: NO_INTERNAL_RATE_LIMIT,
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to undeploy workflow'),
  mapInput: ({ params }) => ({ workflowId: params.id, requestId: generateRequestId() }),
  present: (result) => ({
    isDeployed: false,
    deployedAt: null,
    apiKey: null,
    warnings: result.warnings,
  }),
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'workflow_undeployed',
      { workflow_id: result.workflowId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
