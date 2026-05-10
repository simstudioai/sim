import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  createMcpServerContract,
  deleteMcpServerContract,
  discoverMcpToolsContract,
  getAllowedMcpDomainsContract,
  listMcpServersContract,
  listStoredMcpToolsContract,
  type McpServer,
  type McpServerTestBody,
  type McpServerTestResult,
  type RefreshMcpServerResult,
  refreshMcpServerContract,
  testMcpServerConnectionContract,
  updateMcpServerContract,
} from '@/lib/api/contracts/mcp'
import { sanitizeForHttp, sanitizeHeaders } from '@/lib/mcp/shared'
import type { McpTool, McpTransport, StoredMcpTool } from '@/lib/mcp/types'
import { workflowMcpServerKeys } from '@/hooks/queries/workflow-mcp-servers'

const logger = createLogger('McpQueries')

export type { McpTool, StoredMcpTool }

export const mcpKeys = {
  all: ['mcp'] as const,
  servers: (workspaceId: string) => [...mcpKeys.all, 'servers', workspaceId] as const,
  tools: (workspaceId: string) => [...mcpKeys.all, 'tools', workspaceId] as const,
  storedTools: (workspaceId: string) => [...mcpKeys.all, 'stored', workspaceId] as const,
  allowedDomains: () => [...mcpKeys.all, 'allowedDomains'] as const,
}

export type { McpServer }

/**
 * Input for creating/updating an MCP server (distinct from McpServerConfig in types.ts)
 */
interface McpServerInput {
  name: string
  transport: McpTransport
  url?: string
  timeout: number
  headers?: Record<string, string>
  enabled: boolean
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
  try {
    const data = await requestJson(discoverMcpToolsContract, {
      query: { workspaceId, refresh: forceRefresh || undefined },
      signal,
    })
    return data.data.tools
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return []
    }
    throw error
  }
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

      const data = await requestJson(createMcpServerContract, {
        body: serverData,
      })

      const serverId = data.data.serverId
      const wasUpdated = data.data.updated === true

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
      const data = await requestJson(deleteMcpServerContract, {
        query: { serverId, workspaceId },
      })

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

      const data = await requestJson(updateMcpServerContract, {
        params: { id: serverId },
        query: { workspaceId },
        body: sanitizedUpdates,
      })

      logger.info(`Updated MCP server: ${serverId} in workspace: ${workspaceId}`)
      return data.data.server
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

export type { RefreshMcpServerResult }

export function useRefreshMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      serverId,
    }: RefreshMcpServerParams): Promise<RefreshMcpServerResult> => {
      const data = await requestJson(refreshMcpServerContract, {
        params: { id: serverId },
        query: { workspaceId },
      })

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
  const data = await requestJson(listStoredMcpToolsContract, {
    query: { workspaceId },
    signal,
  })
  return data.data.tools
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

export type McpServerTestConfig = McpServerTestBody & {
  workspaceId: string
}

export type { McpServerTestResult }

function isMcpTestErrorBody(body: unknown): body is { data?: McpServerTestResult } {
  return Boolean(body) && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
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

  try {
    const data = await requestJson(testMcpServerConnectionContract, {
      body: cleanConfig,
      signal,
    })
    return data.data
  } catch (error) {
    if (error instanceof ApiClientError && isMcpTestErrorBody(error.body) && error.body.data) {
      const inner = error.body.data
      if (inner.error || inner.success === false) {
        return {
          success: false,
          message: inner.error || 'Connection failed',
          error: inner.error,
          warnings: inner.warnings,
        }
      }
    }
    throw error
  }
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
  const data = await requestJson(getAllowedMcpDomainsContract, { signal })
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
