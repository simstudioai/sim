import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getWorkspaceMcpServer, type McpServerRow } from '@/lib/mcp/queries'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'

export interface McpWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

export interface McpServerContext extends McpWorkspaceContext {
  server: McpServerRow
}

export async function resolveMcpWorkspaceContext(
  workspaceId: string
): Promise<McpWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

export async function resolveMcpServerContext(
  workspaceId: string,
  serverId: string
): Promise<McpServerContext> {
  const workspace = await resolveMcpWorkspaceContext(workspaceId)
  const server = await getWorkspaceMcpServer({ workspaceId: workspace.workspaceId, serverId })
  if (!server) throw new OrchestrationError('not_found', 'MCP server not found')
  return { ...workspace, server }
}
