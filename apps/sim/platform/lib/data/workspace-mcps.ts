'use client'

import { workspacePath } from '@/lib/navigation/paths'
import { mcpServerIdParam } from '@/lib/settings/search-params'
import { useMcpServers } from '@/hooks/queries/mcp'

/**
 * One workspace's custom MCP servers for the Integrations MCPs tab, each opening its page in the
 * workspace's MCP settings, where servers are connected and managed.
 */
export function useWorkspaceMcpServers(workspaceId: string | undefined) {
  const query = useMcpServers(workspaceId ?? '')
  return {
    query,
    servers: workspaceId
      ? query.data?.map((server) => ({
          id: server.id,
          name: server.name,
          description: server.description || server.url || '',
          href: workspacePath(
            workspaceId,
            `settings/mcp?${new URLSearchParams({ [mcpServerIdParam.key]: server.id })}`
          ),
        }))
      : undefined,
    connectHref: workspaceId && workspacePath(workspaceId, 'settings/mcp'),
  }
}
