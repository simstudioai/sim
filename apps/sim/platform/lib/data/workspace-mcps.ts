'use client'

import { workspacePath } from '@/lib/navigation/paths'
import { mcpServerIdParam } from '@/lib/settings/search-params'
import { useMcpServers } from '@/hooks/queries/mcp'
import { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'

/**
 * One workspace's custom MCP servers for the Integrations MCPs tab, each opening its page in the
 * workspace's MCP settings, where servers are connected and managed. A server Search manages for a
 * connected account or a managed connector is not one the workspace added, so the tab leaves it out,
 * as the MCP tool picker does. With `enabled` false the servers are left unread. Connecting a server
 * needs write access to the workspace, so `connectHref` is absent for a reader.
 */
export function useWorkspaceMcpServers(workspaceId: string | undefined, enabled = true) {
  const query = useMcpServers(enabled ? (workspaceId ?? '') : '')
  const { canEdit } = useWorkspaceUserPermissions(workspaceId ?? '')
  return {
    query,
    servers: workspaceId
      ? query.data
          ?.filter((server) => !server.credentialGroupId && !server.managedConnectorId)
          .map((server) => ({
            id: server.id,
            name: server.name,
            description: server.description || server.url || '',
            href: workspacePath(
              workspaceId,
              `settings/mcp?${new URLSearchParams({ [mcpServerIdParam.key]: server.id })}`
            ),
          }))
      : undefined,
    connectHref: workspaceId && canEdit ? workspacePath(workspaceId, 'settings/mcp') : undefined,
  }
}
