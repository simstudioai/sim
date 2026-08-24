import { v2RestoreWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { workspaceResourceWebUrl } from '@/lib/resources'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { restoreWorkflow } from '@/lib/workflows/application/restore-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Un-archives a workflow, along with the schedules, webhooks, MCP tools, and
 * chats that were archived with it. A workflow that is not archived is a `409`,
 * not a silent success.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.restore,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: restoreWorkflow,
  present: ({ workflow, workspaceId, folderPath }) => ({
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
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    },
  }),
})
