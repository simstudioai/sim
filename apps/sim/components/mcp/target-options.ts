import type { McpServer } from '@/lib/api/contracts/mcp'
import { isMcpRuntimeReference } from '@/lib/mcp/operation-policy'

/** Lists canonical servers alongside direct connections, and scopes the connection picker. */
export function getMcpTargetOptions(
  servers: McpServer[],
  kind: 'server' | 'connection',
  configuredServer?: unknown
): Array<{ value: string; label: string; managedConnectorId?: McpServer['managedConnectorId'] }> {
  const active = servers.filter((server) => server.enabled && !server.deletedAt)
  if (kind === 'connection') {
    return active
      .filter(
        (server) =>
          server.canonicalServerId &&
          (!configuredServer ||
            isMcpRuntimeReference(configuredServer) ||
            server.canonicalServerId === configuredServer)
      )
      .map((server) => ({
        value: server.id,
        label: server.name,
        managedConnectorId: server.managedConnectorId,
      }))
  }
  const canonical = new Map<
    string,
    { value: string; label: string; managedConnectorId?: McpServer['managedConnectorId'] }
  >()
  for (const server of active) {
    if (server.canonicalServerId && server.canonicalServerName)
      canonical.set(server.canonicalServerId, {
        value: server.canonicalServerId,
        label: server.canonicalServerName,
        managedConnectorId: server.managedConnectorId,
      })
  }
  return [
    ...canonical.values(),
    ...active.map((server) => ({
      value: server.id,
      label: server.name,
      managedConnectorId: server.managedConnectorId,
    })),
  ]
}
