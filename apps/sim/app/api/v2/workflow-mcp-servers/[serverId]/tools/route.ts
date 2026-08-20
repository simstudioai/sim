import { v2DeployWorkflowMcpToolContract } from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { deployWorkflowMcpTool } from '@/lib/mcp/application/workflow-deployments'
import {
  toV2WorkflowMcpTool,
  workflowMcpServerErrorPolicy,
} from '@/app/api/v2/workflow-mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workflow-mcp-servers/[serverId]/tools — Publish a workflow as a tool.
 *
 * Idempotent per workflow: a server carries at most one tool per workflow, so a
 * repeat call replaces the existing tool and answers `200` with `updated: true`
 * rather than `201` or a conflict. The workflow must already be deployed — the
 * tool schema is generated from the deployed input format, so an undeployed
 * workflow has nothing to publish.
 */
export const POST = defineV2JsonRoute({
  contract: v2DeployWorkflowMcpToolContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.deployWorkflowTool,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ params, body }) => ({
    serverId: params.serverId,
    workflowId: body.workflowId,
    toolName: body.toolName,
    toolDescription: body.toolDescription,
    parameterDescriptions: body.parameterDescriptions,
  }),
  useCase: deployWorkflowMcpTool,
  present: ({ tool, updated }) => ({ data: toV2WorkflowMcpTool(tool, updated) }),
})
