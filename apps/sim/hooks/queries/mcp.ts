import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('McpQueries')

/**
 * Query key factories for MCP-related queries
 */
export const mcpKeys = {
  all: ['mcp'] as const,
  servers: (workspaceId: string) => [...mcpKeys.all, 'servers', workspaceId] as const,
  tools: (workspaceId: string) => [...mcpKeys.all, 'tools', workspaceId] as const,
}

/**
 * MCP Server Types
 */
export interface McpServer {
  id: string
  workspaceId: string
  name: string
  transport: 'streamable-http' | 'stdio'
  url?: string
  timeout: number
  headers?: Record<string, string>
  enabled: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string
  toolCount?: number
  lastToolsRefresh?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface McpServerConfig {
  name: string
  transport: 'streamable-http' | 'stdio'
  url?: string
  timeout: number
  headers?: Record<string, string>
  enabled: boolean
}

export interface McpTool {
  id: string
  serverId: string
  name: string
  description?: string
}

/**
 * Fetch MCP servers for a workspace
 */
async function fetchMcpServers(workspaceId: string): Promise<McpServer[]> {
  const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`)

  // Treat 404 as "no servers configured" - return empty array
  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch MCP servers')
  }

  return data.data?.servers || []
}

/**
 * Hook to fetch MCP servers
 */
export function useMcpServers(workspaceId: string) {
  return useQuery({
    queryKey: mcpKeys.servers(workspaceId),
    queryFn: () => fetchMcpServers(workspaceId),
    enabled: !!workspaceId,
    retry: false, // Don't retry on 404 (no servers configured)
    staleTime: 60 * 1000, // 1 minute - servers don't change frequently
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch MCP tools for a workspace
 */
async function fetchMcpTools(workspaceId: string): Promise<McpTool[]> {
  const response = await fetch(`/api/mcp/tools/discover?workspaceId=${workspaceId}`)

  // Treat 404 as "no tools available" - return empty array
  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch MCP tools')
  }

  return data.data?.tools || []
}

/**
 * Hook to fetch MCP tools
 */
export function useMcpToolsQuery(workspaceId: string) {
  return useQuery({
    queryKey: mcpKeys.tools(workspaceId),
    queryFn: () => fetchMcpTools(workspaceId),
    enabled: !!workspaceId,
    retry: false, // Don't retry on 404 (no tools available)
    staleTime: 30 * 1000, // 30 seconds - tools can change when servers are added/removed
    placeholderData: keepPreviousData,
  })
}

/**
 * Create MCP server mutation
 */
interface CreateMcpServerParams {
  workspaceId: string
  config: McpServerConfig
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, config }: CreateMcpServerParams) => {
      const serverData = {
        ...config,
        workspaceId,
        id: `mcp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const response = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create MCP server')
      }

      logger.info(`Created MCP server: ${config.name} in workspace: ${workspaceId}`)
      return { ...serverData, connectionStatus: 'disconnected' as const }
    },
    onSuccess: (_data, variables) => {
      // Invalidate servers list to refetch
      queryClient.invalidateQueries({ queryKey: mcpKeys.servers(variables.workspaceId) })
      // Invalidate tools as new server may provide new tools
      queryClient.invalidateQueries({ queryKey: mcpKeys.tools(variables.workspaceId) })
    },
  })
}

/**
 * Delete MCP server mutation
 */
interface DeleteMcpServerParams {
  workspaceId: string
  serverId: string
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, serverId }: DeleteMcpServerParams) => {
      const response = await fetch(
        `/api/mcp/servers?serverId=${serverId}&workspaceId=${workspaceId}`,
        {
          method: 'DELETE',
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete MCP server')
      }

      logger.info(`Deleted MCP server: ${serverId} from workspace: ${workspaceId}`)
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.servers(variables.workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.tools(variables.workspaceId) })
    },
  })
}

/**
 * Update MCP server mutation
 */
interface UpdateMcpServerParams {
  workspaceId: string
  serverId: string
  updates: Partial<McpServerConfig>
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, serverId, updates }: UpdateMcpServerParams) => {
      logger.info(`Updated MCP server: ${serverId} in workspace: ${workspaceId}`)
      return { serverId, updates }
    },
    onMutate: async ({ workspaceId, serverId, updates }) => {
      await queryClient.cancelQueries({ queryKey: mcpKeys.servers(workspaceId) })

      const previousServers = queryClient.getQueryData<McpServer[]>(mcpKeys.servers(workspaceId))

      if (previousServers) {
        queryClient.setQueryData<McpServer[]>(
          mcpKeys.servers(workspaceId),
          previousServers.map((server) =>
            server.id === serverId
              ? { ...server, ...updates, updatedAt: new Date().toISOString() }
              : server
          )
        )
      }

      return { previousServers }
    },
    onError: (_err, variables, context) => {
      if (context?.previousServers) {
        queryClient.setQueryData(mcpKeys.servers(variables.workspaceId), context.previousServers)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.servers(variables.workspaceId) })
    },
  })
}

/**
 * Test MCP server connection
 */
export interface McpServerTestParams {
  name: string
  transport: 'streamable-http' | 'stdio'
  url?: string
  headers?: Record<string, string>
  timeout: number
  workspaceId: string
}

export interface McpServerTestResult {
  success: boolean
  error?: string
  tools?: Array<{ name: string; description?: string }>
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: async (params: McpServerTestParams): Promise<McpServerTestResult> => {
      try {
        const response = await fetch('/api/mcp/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        })

        const data = await response.json()

        if (!response.ok) {
          return {
            success: false,
            error: data.error || 'Failed to test connection',
          }
        }

        return {
          success: true,
          tools: data.tools || [],
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Connection test failed',
        }
      }
    },
  })
}
