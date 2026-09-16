import type { McpServer } from '@/lib/api/contracts/mcp'

/** Lists executable shared servers and managed account connections using their own IDs. */
export function getMcpTargetOptions(servers: McpServer[]) {
  return servers
    .filter((server) => server.enabled && !server.deletedAt)
    .map((server) => ({
      value: server.id,
      label: server.name,
      managedConnectorId: server.managedConnectorId,
    }))
}
