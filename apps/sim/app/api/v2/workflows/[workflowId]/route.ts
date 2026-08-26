import {
  v2DeleteWorkflowContract,
  v2GetWorkflowContract,
  v2UpdateWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { workspaceResourceWebUrl } from '@/lib/resources'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflow } from '@/lib/workflows/application/read-workflow'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'

export const revalidate = 0

/**
 * Deliberately head-safe despite issuing a write.
 *
 * Reading a workflow can trigger a migrate-on-read `workflow_blocks` update when
 * `applyBlockMigrations` upgrades a stored block. That write is convergent: it is
 * conditional on a migration actually applying, idempotent, and would be issued by
 * the next ordinary read regardless, so a `HEAD` only brings it forward.
 *
 * Declaring `headSafe: false` would also cost real capability: the bodiless
 * `200` is unconditional, so a `HEAD` could no longer distinguish a workflow
 * that exists from one that does not.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: readWorkflow,
  present: ({ workflow, workspaceId, folderPath, inputs }) => ({
    data: {
      id: workflow.id,
      webUrl: workspaceResourceWebUrl(getBaseUrl(), workspaceId, 'workflow', workflow.id),
      name: workflow.name,
      description: workflow.description,
      folderPath,
      workspaceId,
      isDeployed: workflow.isDeployed,
      deployedAt: workflow.deployedAt?.toISOString() ?? null,
      runCount: workflow.runCount,
      lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
      variables: (workflow.variables as Record<string, unknown> | null) ?? {},
      inputs,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    },
  }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({ workflowId: params.workflowId, ...body }),
  useCase: updateWorkflow,
  present: ({ workflow, workspaceId, folderPath, deployment }) => ({
    data: {
      id: workflow.id,
      webUrl: workspaceResourceWebUrl(getBaseUrl(), workspaceId, 'workflow', workflow.id),
      name: workflow.name,
      description: workflow.description,
      folderPath,
      workspaceId,
      isDeployed: deployment.isDeployed,
      deployedAt: deployment.deployedAt?.toISOString() ?? null,
      runCount: deployment.runCount,
      lastRunAt: deployment.lastRunAt?.toISOString() ?? null,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    },
  }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: deleteWorkflow,
  present: ({ workflowId }) => ({
    data: { id: workflowId, deleted: true as const, archived: true as const },
  }),
})
