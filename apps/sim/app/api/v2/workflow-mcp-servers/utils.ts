import {
  type V2WorkflowMcpServer,
  type V2WorkflowMcpServerListItem,
  type V2WorkflowMcpTool,
  type V2WorkflowMcpToolListItem,
  v2WorkflowMcpServerListItemSchema,
  v2WorkflowMcpServerSchema,
  v2WorkflowMcpToolListItemSchema,
  v2WorkflowMcpToolSchema,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import type { WorkflowMcpServerRow, WorkflowMcpToolRow } from '@/lib/mcp/queries'
import { buildWorkflowMcpApiEndpoint, buildWorkflowMcpServerUrl } from '@/lib/mcp/urls'

/**
 * Shared serialization + error mapping for the v2 workflow-MCP surface.
 */

/**
 * Projects a stored workflow-MCP server row onto the public shape.
 *
 * The row is parsed through {@link v2WorkflowMcpServerSchema}, whose strip
 * behaviour is the boundary: `createdBy` and `deletedAt` are dropped rather than
 * enumerated by hand, so a column added later cannot leak by omission.
 */
export function toV2WorkflowMcpServer(row: WorkflowMcpServerRow): V2WorkflowMcpServer {
  return v2WorkflowMcpServerSchema.parse({
    ...row,
    mcpServerUrl: buildWorkflowMcpServerUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** {@link toV2WorkflowMcpServer} plus the tool inventory only the list reads. */
export function toV2WorkflowMcpServerListItem(
  row: WorkflowMcpServerRow & { toolCount: number; toolNames: string[] }
): V2WorkflowMcpServerListItem {
  return v2WorkflowMcpServerListItemSchema.parse({
    ...row,
    mcpServerUrl: buildWorkflowMcpServerUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

export const workflowMcpServerErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'MCP server not found',
})

/**
 * Projects a stored workflow-MCP tool row onto the public shape.
 *
 * `updated` is not a column — it is whether the publish replaced an existing
 * tool — so it is passed in rather than read off the row.
 */
export function toV2WorkflowMcpTool(row: WorkflowMcpToolRow, updated: boolean): V2WorkflowMcpTool {
  return v2WorkflowMcpToolSchema.parse({
    ...row,
    mcpServerUrl: buildWorkflowMcpServerUrl(row.serverId),
    apiEndpoint: buildWorkflowMcpApiEndpoint(row.workflowId),
    updated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** {@link toV2WorkflowMcpTool} for a read, which has no publish outcome to report. */
export function toV2WorkflowMcpToolListItem(row: WorkflowMcpToolRow): V2WorkflowMcpToolListItem {
  return v2WorkflowMcpToolListItemSchema.parse({
    ...row,
    mcpServerUrl: buildWorkflowMcpServerUrl(row.serverId),
    apiEndpoint: buildWorkflowMcpApiEndpoint(row.workflowId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}
