import {
  v2CreateWorkflowMcpServerContract,
  v2ListWorkflowMcpServersContract,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  createWorkflowMcpDeploymentServer,
  listWorkflowMcpDeployments,
} from '@/lib/mcp/application/workflow-deployments'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import {
  toV2WorkflowMcpServer,
  toV2WorkflowMcpServerListItem,
  workflowMcpServerErrorPolicy,
} from '@/app/api/v2/workflow-mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which servers, in which order, this list returns. */
function workflowMcpServerCursorFilters(query: { workspaceId: string }) {
  return cursorScopeKey(cursorRoute(v2ListWorkflowMcpServersContract), {
    workspaceId: query.workspaceId,
  })
}

/**
 * GET /api/v2/workflow-mcp-servers — List MCP servers a workspace publishes.
 *
 * These are servers Sim *serves*; `GET /api/v2/mcp-servers` lists the external
 * ones Sim *calls*. Nothing caps how many a workspace publishes, so the list is
 * keyset-paged like its sibling.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowMcpServersContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.listWorkflowDeployments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      workflowMcpServerCursorFilters(query)
    ),
  }),
  useCase: listWorkflowMcpDeployments,
  present: ({ servers, nextCursorKeys }, { query }) => ({
    data: servers.map(toV2WorkflowMcpServerListItem),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      workflowMcpServerCursorFilters(query)
    ),
  }),
})

/**
 * POST /api/v2/workflow-mcp-servers — Publish a new MCP server.
 *
 * `workflowIds` publishes those workflows as tools in the same transaction; a
 * workflow that is not deployed is refused there rather than silently skipped.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateWorkflowMcpServerContract,
  auth: v2ApiKeyAuth,
  operation: mcpServerOperations.createWorkflowDeploymentServer,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workflowMcpServerErrorPolicy,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    isPublic: body.isPublic,
    workflowIds: body.workflowIds,
  }),
  useCase: createWorkflowMcpDeploymentServer,
  present: ({ server }) => ({ data: toV2WorkflowMcpServer(server) }),
})
