import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sanitizeForHttp, sanitizeHeaders } from '@/lib/mcp/shared'
import type { McpServerStatusConfig, McpTool, McpTransport, StoredMcpTool } from '@/lib/mcp/types'
import { workflowMcpServerKeys } from '@/hooks/queries/workflow-mcp-servers'

const logger = createLogger('McpQueries')

export type { McpServerStatusConfig, McpTool, StoredMcpTool }

export const mcpKeys = {
  all: ['mcp'] as const,
  servers: (workspaceId: string) => [...mcpKeys.all, 'servers', workspaceId] as const,
  tools: (workspaceId: string) => [...mcpKeys.all, 'tools', workspaceId] as const,
  storedTools: (workspaceId: string) => [...mcpKeys.all, 'stored', workspaceId] as const,
  allowedDomains: () => [...mcpKeys.all, 'allowedDomains'] as const,
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

async function fetchMcpServers(workspaceId: string, signal?: AbortSignal): Promise<McpServer[]> {
  const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`, { signal })

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
    queryFn: ({ signal }) => fetchMcpServers(workspaceId, signal),
    enabled: !!workspaceId,
    retry: false,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

async function fetchMcpTools(
  workspaceId: string,
  forceRefresh = false,
  signal?: AbortSignal
): Promise<McpTool[]> {
  const params = new URLSearchParams({ workspaceId })
  if (forceRefresh) {
    params.set('refresh', 'true')
  }

  const response = await fetch(`/api/mcp/tools/discover?${params.toString()}`, { signal })

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
    queryFn: ({ signal }) => fetchMcpTools(workspaceId, false, signal),
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
    },
    onSettled: (_, __, variables) => {
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

async function fetchStoredMcpTools(
  workspaceId: string,
  signal?: AbortSignal
): Promise<StoredMcpTool[]> {
  const response = await fetch(`/api/mcp/tools/stored?workspaceId=${workspaceId}`, { signal })

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
    queryFn: ({ signal }) => fetchStoredMcpTools(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

/**
 * Shared EventSource connections keyed by workspaceId.
 * Reference-counted so the connection is closed when the last consumer unmounts.
 * Attached to `globalThis` so connections survive HMR in development.
 */
const SSE_KEY = '__mcp_sse_connections' as const

type SseEntry = { source: EventSource; refs: number }

const sseConnections: Map<string, SseEntry> =
  ((globalThis as Record<string, unknown>)[SSE_KEY] as Map<string, SseEntry>) ??
  ((globalThis as Record<string, unknown>)[SSE_KEY] = new Map<string, SseEntry>())

/**
 * Subscribe to MCP tool-change SSE events for a workspace.
 * On each `tools_changed` event, invalidates the relevant React Query caches
 * so the UI refreshes automatically.
 *
 * Invalidates both external MCP server keys and workflow MCP server keys.
 */
export function useMcpToolsEvents(workspaceId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.tools(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.servers(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedTools(workspaceId) })
      queryClient.invalidateQueries({ queryKey: workflowMcpServerKeys.all })
    }

    let entry = sseConnections.get(workspaceId)

    if (!entry) {
      const source = new EventSource(`/api/mcp/events?workspaceId=${workspaceId}`)

      source.addEventListener('tools_changed', () => {
        invalidate()
      })

      source.onerror = () => {
        logger.warn(`SSE connection error for workspace ${workspaceId}`)
      }

      entry = { source, refs: 0 }
      sseConnections.set(workspaceId, entry)
    }

    entry.refs++

    return () => {
      const current = sseConnections.get(workspaceId)
      if (!current) return

      current.refs--
      if (current.refs <= 0) {
        current.source.close()
        sseConnections.delete(workspaceId)
      }
    }
  }, [workspaceId, queryClient])
}

export interface McpServerTestConfig {
  name: string
  transport: McpTransport
  url?: string
  headers?: Record<string, string>
  timeout?: number
  workspaceId: string
}

export interface McpServerTestResult {
  success: boolean
  message: string
  error?: string
  negotiatedVersion?: string
  supportedCapabilities?: string[]
  toolCount?: number
  warnings?: string[]
}

async function testMcpServerConnection(
  config: McpServerTestConfig,
  signal?: AbortSignal
): Promise<McpServerTestResult> {
  const cleanConfig = {
    ...config,
    url: config.url ? sanitizeForHttp(config.url) : config.url,
    headers: sanitizeHeaders(config.headers) || {},
  }

  const response = await fetch('/api/mcp/servers/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleanConfig),
    signal,
  })

  const result = await response.json()

  if (!response.ok) {
    if (result.data?.error || result.data?.success === false) {
      return {
        success: false,
        message: result.data.error || 'Connection failed',
        error: result.data.error,
        warnings: result.data.warnings,
      }
    }
    throw new Error(result.error || 'Connection test failed')
  }

  return result.data || result
}

export function useMcpServerTest() {
  const mutation = useMutation({
    mutationFn: (config: McpServerTestConfig) => testMcpServerConnection(config),
    onSuccess: (result, variables) => {
      logger.info(`MCP server test ${result.success ? 'passed' : 'failed'}:`, variables.name)
    },
    onError: (error) => {
      logger.error('MCP server test failed:', error instanceof Error ? error.message : error)
    },
  })

  return {
    testResult:
      mutation.data ??
      (mutation.error
        ? ({
            success: false,
            message: 'Connection failed',
            error:
              mutation.error instanceof Error ? mutation.error.message : 'Unknown error occurred',
          } as McpServerTestResult)
        : null),
    isTestingConnection: mutation.isPending,
    testConnection: mutation.mutateAsync,
    clearTestResult: mutation.reset,
  }
}

/**
 * Fetch allowed MCP domains (admin-configured allowlist)
 */
async function fetchAllowedMcpDomains(signal?: AbortSignal): Promise<string[] | null> {
  const response = await fetch('/api/settings/allowed-mcp-domains', { signal })
  if (!response.ok) {
    return null
  }
  const data = await response.json()
  return data.allowedMcpDomains ?? null
}

/**
 * Hook to fetch allowed MCP domains
 */
export function useAllowedMcpDomains() {
  return useQuery<string[] | null>({
    queryKey: mcpKeys.allowedDomains(),
    queryFn: ({ signal }) => fetchAllowedMcpDomains(signal),
    staleTime: 5 * 60 * 1000,
  })
}
