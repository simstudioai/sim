import { useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
  startMcpOauthContract,
  testMcpServerConnectionContract,
  updateMcpServerContract,
} from '@/lib/api/contracts/mcp'
import { isLoopbackHostname } from '@/lib/core/utils/urls'
import { sanitizeForHttp, sanitizeHeaders } from '@/lib/mcp/shared'
import type {
  McpAuthType,
  McpServerStatusConfig,
  McpTool,
  McpTransport,
  StoredMcpTool,
} from '@/lib/mcp/types'
import { workflowMcpServerKeys } from '@/hooks/queries/workflow-mcp-servers'

const logger = createLogger('McpQueries')

export type { McpServerStatusConfig, McpTool, StoredMcpTool }

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

export type { McpServer }

/** Wire shape for create/update; distinct from runtime McpServerConfig. */
export interface McpServerInput {
  name: string
  transport: McpTransport
  url?: string
  timeout: number
  headers?: Record<string, string>
  enabled: boolean
  oauthClientId?: string
  oauthClientSecret?: string
  authType?: McpAuthType
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
    queryKey: mcpKeys.serversList(workspaceId),
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
  signal?: AbortSignal,
  serverId?: string
): Promise<McpTool[]> {
  try {
    const data = await requestJson(discoverMcpToolsContract, {
      query: {
        workspaceId,
        refresh: forceRefresh || undefined,
        ...(serverId ? { serverId } : {}),
      },
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

/**
 * Workspace aggregate derived from N parallel per-server queries via
 * `useQueries`. One slow server cannot block the others.
 */
export function useMcpToolsQuery(workspaceId: string) {
  const { data: servers, isLoading: serversLoading } = useMcpServers(workspaceId)

  // Skip disabled rows (would 404 → negative-cache) and rows from a previous
  // workspace (keepPreviousData on useMcpServers).
  const serverIds = useMemo(
    () =>
      servers
        ? servers
            .filter((s) => s.enabled && s.workspaceId === workspaceId)
            .map((s) => s.id)
            .sort()
        : [],
    [servers, workspaceId]
  )

  const results = useQueries({
    queries: serverIds.map((serverId) => ({
      queryKey: mcpKeys.serverToolsList(workspaceId, serverId),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchMcpTools(workspaceId, false, signal, serverId),
      enabled: !!workspaceId,
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    })),
  })

  return useMemo(() => {
    const tools: McpTool[] = []
    let hasData = false
    let anyServerLoading = false
    let firstError: Error | null = null
    for (const result of results) {
      // Drop stale data from servers whose latest refetch errored.
      if (result.data && !result.isError) {
        tools.push(...result.data)
        hasData = true
      }
      if (result.isLoading) anyServerLoading = true
      if (!firstError && result.error instanceof Error) firstError = result.error
    }
    return {
      data: tools,
      isLoading: (serversLoading || anyServerLoading) && !hasData,
      isFetching: serversLoading || results.some((r) => r.isFetching),
      // Suppress when any healthy server rendered; per-server errors live in `perServer`.
      error: hasData ? null : firstError,
      perServer: results,
    }
  }, [results, serversLoading])
}

export function useForceRefreshMcpTools() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const allServers =
        queryClient.getQueryData<McpServer[]>(mcpKeys.serversList(workspaceId)) ?? []
      const servers = allServers.filter((s) => s.enabled && s.workspaceId === workspaceId)
      const results = await Promise.allSettled(
        servers.map(async (server) => {
          const tools = await fetchMcpTools(workspaceId, true, undefined, server.id)
          queryClient.setQueryData(mcpKeys.serverToolsList(workspaceId, server.id), tools)
          return tools
        })
      )
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const failedServer = servers[index]
          if (failedServer) {
            queryClient.invalidateQueries({
              queryKey: mcpKeys.serverToolsList(workspaceId, failedServer.id),
            })
          }
        }
      })
      return results
        .filter((r): r is PromiseFulfilledResult<McpTool[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value)
    },
    onSettled: (_data, _error, workspaceId) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
    },
  })
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
      const authType = data.data.authType

      logger.info(
        wasUpdated
          ? `Updated existing MCP server: ${config.name} (ID: ${serverId})`
          : `Created MCP server: ${config.name} (ID: ${serverId})`
      )

      const { oauthClientSecret: _omitSecret, ...safeServerData } = serverData
      return {
        ...safeServerData,
        id: serverId,
        connectionStatus: authType === 'oauth' ? ('disconnected' as const) : ('connected' as const),
        serverId,
        updated: wasUpdated,
        authType,
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: mcpKeys.serverToolsWorkspace(variables.workspaceId),
      })
    },
  })
}

/** On `redirect`, the caller must wait for `popup.closed` or the `mcp-oauth` postMessage. */
export type StartMcpOauthMutationResult =
  | { status: 'redirect'; popup: Window }
  | { status: 'already_authorized' }

export function useStartMcpOauth() {
  return useMutation<StartMcpOauthMutationResult, Error, { serverId: string; workspaceId: string }>(
    {
      mutationFn: async ({ serverId, workspaceId }) => {
        const result = await requestJson(startMcpOauthContract, {
          query: { serverId, workspaceId },
        })
        if (result.status === 'already_authorized') return { status: 'already_authorized' }

        const parsedUrl = new URL(result.authorizationUrl)
        const isLoopbackHttp =
          parsedUrl.protocol === 'http:' && isLoopbackHostname(parsedUrl.hostname)
        if (parsedUrl.protocol !== 'https:' && !isLoopbackHttp) {
          throw new Error('Authorization URL must use HTTPS')
        }
        const popup = window.open(
          result.authorizationUrl,
          `mcp-oauth-${serverId}`,
          'width=560,height=720,resizable=yes,scrollbars=yes'
        )
        if (!popup) {
          throw new Error('Popup blocked. Please allow popups for this site and retry.')
        }
        return { status: 'redirect', popup }
      },
    }
  )
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(variables.workspaceId) })
      queryClient.removeQueries({
        queryKey: mcpKeys.serverToolsList(variables.workspaceId, variables.serverId),
      })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(variables.workspaceId) })
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
      await queryClient.cancelQueries({ queryKey: mcpKeys.serversList(workspaceId) })

      const previousServers = queryClient.getQueryData<McpServer[]>(
        mcpKeys.serversList(workspaceId)
      )

      if (previousServers) {
        const { oauthClientSecret: _omitSecret, oauthClientId, ...rest } = updates
        const safeUpdates: Partial<McpServer> = { ...rest }
        if (oauthClientId !== undefined) {
          safeUpdates.oauthClientId = oauthClientId || undefined
        }
        queryClient.setQueryData<McpServer[]>(
          mcpKeys.serversList(workspaceId),
          previousServers.map((server) =>
            server.id === serverId
              ? { ...server, ...safeUpdates, updatedAt: new Date().toISOString() }
              : server
          )
        )
      }

      return { previousServers }
    },
    onError: (_err, variables, context) => {
      if (context?.previousServers) {
        queryClient.setQueryData(
          mcpKeys.serversList(variables.workspaceId),
          context.previousServers
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: mcpKeys.serverToolsList(variables.workspaceId, variables.serverId),
      })
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: mcpKeys.serverToolsList(variables.workspaceId, variables.serverId),
      })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(variables.workspaceId) })
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
    queryKey: mcpKeys.storedToolsList(workspaceId),
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

/** Subscribes to `tools_changed` SSE events and invalidates the affected query keys. */
export function useMcpToolsEvents(workspaceId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const invalidate = (serverId?: string) => {
      if (serverId) {
        queryClient.invalidateQueries({
          queryKey: mcpKeys.serverToolsList(workspaceId, serverId),
        })
      } else {
        queryClient.invalidateQueries({ queryKey: mcpKeys.serverToolsWorkspace(workspaceId) })
      }
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
      queryClient.invalidateQueries({ queryKey: workflowMcpServerKeys.all })
    }

    let entry = sseConnections.get(workspaceId)

    if (!entry) {
      const source = new EventSource(`/api/mcp/events?workspaceId=${workspaceId}`)

      source.addEventListener('tools_changed', (e) => {
        let serverId: string | undefined
        try {
          const parsed = JSON.parse((e as MessageEvent).data) as { serverId?: string }
          serverId = parsed.serverId
        } catch {
          // Non-JSON payload → workspace-wide fallback.
        }
        invalidate(serverId)
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
      logger.error('MCP server test failed:', getErrorMessage(error))
    },
  })

  return {
    testResult:
      mutation.data ??
      (mutation.error
        ? ({
            success: false,
            message: 'Connection failed',
            error: getErrorMessage(mutation.error, 'Unknown error occurred'),
          } as McpServerTestResult)
        : null),
    isTestingConnection: mutation.isPending,
    testConnection: mutation.mutateAsync,
    clearTestResult: mutation.reset,
  }
}

async function fetchAllowedMcpDomains(signal?: AbortSignal): Promise<string[] | null> {
  const data = await requestJson(getAllowedMcpDomainsContract, { signal })
  return data.allowedMcpDomains ?? null
}

export function useAllowedMcpDomains() {
  return useQuery<string[] | null>({
    queryKey: mcpKeys.allowedDomains(),
    queryFn: ({ signal }) => fetchAllowedMcpDomains(signal),
    staleTime: 5 * 60 * 1000,
  })
}
