import {
  v2DeleteWorkflowMcpServerContract,
  v2UpdateWorkflowMcpServerContract,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  deleteWorkflowMcpDeploymentServer,
  updateWorkflowMcpDeploymentServer,
} from '@/lib/mcp/application/workflow-deployments'
import {
  toV2WorkflowMcpServer,
  workflowMcpServerErrorPolicy,
} from '@/app/api/v2/workflow-mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** PATCH /api/v2/workflow-mcp-servers/[serverId] — Rename or re-scope a published server. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowMcpServerContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.updateWorkflowDeploymentServer,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ params, body }) => ({
    serverId: params.serverId,
    name: body.name,
    description: body.description,
    isPublic: body.isPublic,
  }),
  useCase: updateWorkflowMcpDeploymentServer,
  present: ({ server }) => ({ data: toV2WorkflowMcpServer(server) }),
})

/**
 * DELETE /api/v2/workflow-mcp-servers/[serverId] — Unpublish a server.
 *
 * Every tool it published stops answering, and connected MCP clients lose the
 * endpoint. The workflows themselves are untouched — their own deployments stay
 * live and executable through the workflow API.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteWorkflowMcpServerContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.deleteWorkflowDeploymentServer,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ params }) => ({ serverId: params.serverId }),
  useCase: deleteWorkflowMcpDeploymentServer,
  present: ({ server }) => ({ data: { id: server.id, deleted: true as const } }),
})
