import {
  v2DeleteWorkflowContract,
  v2GetWorkflowContract,
  v2UpdateWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflow } from '@/lib/workflows/application/read-workflow'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'

export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: readWorkflow,
  present: ({ workflow, workspaceId, folderPath, inputs }) => ({
    data: {
      id: workflow.id,
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
  mapInput: ({ params, body }) => ({ workflowId: params.id, ...body }),
  useCase: updateWorkflow,
  present: ({ workflow, workspaceId, folderPath, deployment }) => ({
    data: {
      id: workflow.id,
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
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: deleteWorkflow,
  present: ({ workflowId }) => ({ data: { id: workflowId, deleted: true as const } }),
})
