import { queryOptions } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { listMcpServersContract, type McpServer } from '@/lib/api/contracts/mcp'

export type { McpServer }

export const MCP_SERVER_LIST_STALE_TIME = 60 * 1000

export const mcpKeys = {
  all: ['mcp'] as const,
  servers: () => [...mcpKeys.all, 'servers'] as const,
  serversList: (workspaceId?: string) => [...mcpKeys.servers(), workspaceId ?? ''] as const,
  serverTools: () => [...mcpKeys.all, 'serverTools'] as const,
  serverToolsWorkspace: (workspaceId?: string) =>
    [...mcpKeys.serverTools(), workspaceId ?? ''] as const,
  serverToolsList: (workspaceId?: string, serverId?: string) =>
    [...mcpKeys.serverToolsWorkspace(workspaceId), serverId ?? ''] as const,
  storedTools: () => [...mcpKeys.all, 'storedTools'] as const,
  storedToolsList: (workspaceId?: string) => [...mcpKeys.storedTools(), workspaceId ?? ''] as const,
  allowedDomains: () => [...mcpKeys.all, 'allowedDomains'] as const,
}

async function fetchMcpServers(workspaceId: string, signal?: AbortSignal): Promise<McpServer[]> {
  try {
    const data = await requestJson(listMcpServersContract, {
      query: { workspaceId },
      signal,
    })
    return data.data.servers
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return []
    }
    throw error
  }
}

export function mcpServersQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: mcpKeys.serversList(workspaceId),
    queryFn: ({ signal }) => fetchMcpServers(workspaceId, signal),
    retry: false,
    retryOnMount: true,
    staleTime: MCP_SERVER_LIST_STALE_TIME,
  })
}
