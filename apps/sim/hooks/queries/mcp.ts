import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sanitizeForHttp, sanitizeHeaders } from '@/lib/mcp/shared'
import type { McpServerStatusConfig, McpTool, StoredMcpTool } from '@/lib/mcp/types'

const logger = createLogger('McpQueries')

export type { McpServerStatusConfig, McpTool, StoredMcpTool }

export const mcpKeys = {
  all: ['mcp'] as const,
  servers: (workspaceId: string) => [...mcpKeys.all, 'servers', workspaceId] as const,
  tools: (workspaceId: string) => [...mcpKeys.all, 'tools', workspaceId] as const,
  storedTools: (workspaceId: string) => [...mcpKeys.all, 'stored', workspaceId] as const,
}

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
  lastError?: string | null
  statusConfig?: McpServerStatusConfig
  toolCount?: number
  lastToolsRefresh?: string
  lastConnected?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

/**
 * Input for creating/updating an MCP server (distinct from McpServerConfig in types.ts)
 */
export interface McpServerInput {
  name: string
  transport: 'streamable-http' | 'stdio'
  url?: string
  timeout: number
  headers?: Record<string, string>
  enabled: boolean
}

async function fetchMcpServers(workspaceId: string): Promise<McpServer[]> {
  const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`)

  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch MCP servers')
  }

  return data.data?.servers || []
}

export function useMcpServers(workspaceId: string) {
  return useQuery({
    queryKey: mcpKeys.servers(workspaceId),
    queryFn: () => fetchMcpServers(workspaceId),
    enabled: !!workspaceId,
    retry: false,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

async function fetchMcpTools(workspaceId: string, forceRefresh = false): Promise<McpTool[]> {
  const params = new URLSearchParams({ workspaceId })
  if (forceRefresh) {
    params.set('refresh', 'true')
  }

  const response = await fetch(`/api/mcp/tools/discover?${params.toString()}`)

  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch MCP tools')
  }

  return data.data?.tools || []
}

export function useMcpToolsQuery(workspaceId: string) {
  return useQuery({
    queryKey: mcpKeys.tools(workspaceId),
    queryFn: () => fetchMcpTools(workspaceId),
    enabled: !!workspaceId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useForceRefreshMcpTools() {
  const queryClient = useQueryClient()

  return async (workspaceId: string) => {
    const freshTools = await fetchMcpTools(workspaceId, true)
    queryClient.setQueryData(mcpKeys.tools(workspaceId), freshTools)
    return freshTools
  }
}

interface CreateMcpServerParams {
  workspaceId: string
  config: McpServerInput
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, config }: CreateMcpServerParams) => {
      const serverData = {
        ...config,
        url: config.url ? sanitizeForHttp(config.url) : config.url,
        headers: sanitizeHeaders(config.headers),
        workspaceId,
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

      const serverId = data.data?.serverId
      const wasUpdated = data.data?.updated === true

      logger.info(
        wasUpdated
          ? `Updated existing MCP server: ${config.name} (ID: ${serverId})`
          : `Created MCP server: ${config.name} (ID: ${serverId})`
      )

      return {
        ...serverData,
        id: serverId,
        connectionStatus: 'connected' as const,
        serverId,
        updated: wasUpdated,
      }
    },
    onSuccess: async (data, variables) => {
      const freshTools = await fetchMcpTools(variables.workspaceId, true)

      const previousServers = queryClient.getQueryData<McpServer[]>(
        mcpKeys.servers(variables.workspaceId)
      )
      if (previousServers) {
        const newServer: McpServer = {
          id: data.id,
          workspaceId: variables.workspaceId,
          name: variables.config.name,
          transport: variables.config.transport,
          url: variables.config.url,
          timeout: variables.config.timeout || 30000,
          headers: variables.config.headers,
          enabled: variables.config.enabled,
          connectionStatus: 'connected',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        const serverExists = previousServers.some((s) => s.id === data.id)
        queryClient.setQueryData<McpServer[]>(
          mcpKeys.servers(variables.workspaceId),
          serverExists
            ? previousServers.map((s) => (s.id === data.id ? { ...s, ...newServer } : s))
            : [...previousServers, newServer]
        )
      }

      queryClient.setQueryData(mcpKeys.tools(variables.workspaceId), freshTools)
      queryClient.invalidateQueries({ queryKey: mcpKeys.servers(variables.workspaceId) })
    },
  })
}

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

interface UpdateMcpServerParams {
  workspaceId: string
  serverId: string
  updates: Partial<McpServerInput>
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, serverId, updates }: UpdateMcpServerParams) => {
      const sanitizedUpdates = {
        ...updates,
        url: updates.url ? sanitizeForHttp(updates.url) : updates.url,
        headers: updates.headers ? sanitizeHeaders(updates.headers) : updates.headers,
      }

      const response = await fetch(`/api/mcp/servers/${serverId}?workspaceId=${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedUpdates),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update MCP server')
      }

      logger.info(`Updated MCP server: ${serverId} in workspace: ${workspaceId}`)
      return data.data?.server
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
      queryClient.invalidateQueries({ queryKey: mcpKeys.tools(variables.workspaceId) })
    },
  })
}

interface RefreshMcpServerParams {
  workspaceId: string
  serverId: string
}

export interface RefreshMcpServerResult {
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  lastConnected: string | null
  error: string | null
  workflowsUpdated: number
  updatedWorkflowIds: string[]
}

export function useRefreshMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      serverId,
    }: RefreshMcpServerParams): Promise<RefreshMcpServerResult> => {
      const response = await fetch(
        `/api/mcp/servers/${serverId}/refresh?workspaceId=${workspaceId}`,
        {
          method: 'POST',
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh MCP server')
      }

      logger.info(`Refreshed MCP server: ${serverId}`)
      return data.data
    },
    onSuccess: async (_data, variables) => {
      const freshTools = await fetchMcpTools(variables.workspaceId, true)
      queryClient.setQueryData(mcpKeys.tools(variables.workspaceId), freshTools)
      await queryClient.invalidateQueries({ queryKey: mcpKeys.servers(variables.workspaceId) })
      await queryClient.refetchQueries({ queryKey: mcpKeys.storedTools(variables.workspaceId) })
    },
  })
}

async function fetchStoredMcpTools(workspaceId: string): Promise<StoredMcpTool[]> {
  const response = await fetch(`/api/mcp/tools/stored?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to fetch stored MCP tools')
  }

  const data = await response.json()
  return data.data?.tools || []
}

export function useStoredMcpTools(workspaceId: string) {
  return useQuery({
    queryKey: mcpKeys.storedTools(workspaceId),
    queryFn: () => fetchStoredMcpTools(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}
