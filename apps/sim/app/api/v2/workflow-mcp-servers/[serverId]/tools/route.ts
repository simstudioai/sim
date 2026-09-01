import {
  v2DeployWorkflowMcpToolContract,
  v2ListWorkflowMcpToolsContract,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  deployWorkflowMcpTool,
  listWorkflowMcpDeploymentTools,
} from '@/lib/mcp/application/workflow-deployments'
import {
  toV2WorkflowMcpTool,
  toV2WorkflowMcpToolListItem,
  workflowMcpServerErrorPolicy,
} from '@/app/api/v2/workflow-mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflow-mcp-servers/[serverId]/tools — List the tools a server publishes.
 *
 * The server list reports tool *names* only, so nothing published the
 * `workflowId` that `DELETE .../tools/{workflowId}` addresses — a caller that
 * did not keep the publish response could not reconcile a server's inventory.
 * Mirrors `GET /api/v2/mcp-servers/{mcpServerId}/tools` beside it.
 *
 * A full set rather than a page, for the same reason as its twin: the inventory
 * is bounded by the workspace's deployed workflows, and a caller reconciling it
 * wants all of it. `nextCursor` is therefore always null.
 *
 * That bound is not unlimited, though, and a set cut short by the ceiling
 * cannot be paged past — so the response carries `truncated`. Without it a
 * reconciling caller read a partial inventory as the complete one and would
 * have unpublished every tool past the cut.
 *
 * Head-safe: nothing is written and no audit is projected.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowMcpToolsContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.listWorkflowDeploymentTools,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ params }) => ({ serverId: params.serverId }),
  useCase: listWorkflowMcpDeploymentTools,
  present: ({ tools, truncated }) => ({
    data: tools.map(toV2WorkflowMcpToolListItem),
    nextCursor: null,
    truncated,
  }),
})

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
