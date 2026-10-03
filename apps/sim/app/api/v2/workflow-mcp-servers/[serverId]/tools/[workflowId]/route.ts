import { v2UndeployWorkflowMcpToolContract } from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { undeployWorkflowMcpTool } from '@/lib/mcp/application/workflow-deployments'
import { workflowMcpServerErrorPolicy } from '@/app/api/v2/workflow-mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * DELETE /api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId] — Unpublish a tool.
 *
 * Addressed by workflow rather than by tool id: a server carries at most one
 * live tool per workflow, and the workflow is the identifier the caller already
 * holds. The workflow's own deployment is untouched.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2UndeployWorkflowMcpToolContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.undeployWorkflowTool,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ params }) => ({ serverId: params.serverId, workflowId: params.workflowId }),
  useCase: undeployWorkflowMcpTool,
  present: ({ tool }) => ({
    data: {
      id: tool.id,
      serverId: tool.serverId,
      workflowId: tool.workflowId,
      deleted: true as const,
    },
  }),
})
