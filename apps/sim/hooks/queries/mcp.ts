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

export const MCP_SERVER_LIST_STALE_TIME = 60 * 1000
/**
 * Tool discovery is kept fresh by the `list_changed` → SSE push (see `useMcpToolsEvents`),
 * so the query only needs a re-probe-on-visit fallback for servers without push. Matches the
 * server-side cache TTL (`MCP_CONSTANTS.CACHE_TIMEOUT`) — no reference MCP client re-probes
 * more often than its cache; real changes arrive via push regardless of this value.
 */
export const MCP_SERVER_TOOLS_STALE_TIME = 5 * 60 * 1000
export const MCP_STORED_TOOL_LIST_STALE_TIME = 60 * 1000
export const MCP_ALLOWED_DOMAINS_STALE_TIME = 5 * 60 * 1000

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
    staleTime: MCP_SERVER_LIST_STALE_TIME,
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

function isServerEligibleForDiscovery(server: McpServer, workspaceId: string): boolean {
  return (
    server.enabled &&
    server.workspaceId === workspaceId &&
    (server.authType !== 'oauth' || server.connectionStatus === 'connected')
  )
}

/**
 * Workspace aggregate derived from N parallel per-server queries via
 * `useQueries`. One slow server cannot block the others.
 */
export function useMcpToolsQuery(workspaceId: string) {
  const queryClient = useQueryClient()
  const { data: servers, isLoading: serversLoading } = useMcpServers(workspaceId)

  /**
   * Skip disabled rows, rows retained from a previous workspace, and OAuth rows
   * that require explicit authorization before discovery can succeed.
   */
  const serverIds = useMemo(
    () =>
      servers
        ? servers
            .filter((server) => isServerEligibleForDiscovery(server, workspaceId))
            .map((s) => s.id)
            .sort()
        : [],
    [servers, workspaceId]
  )

  const results = useQueries({
    queries: serverIds.map((serverId) => ({
      queryKey: mcpKeys.serverToolsList(workspaceId, serverId),
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        try {
          const tools = await fetchMcpTools(workspaceId, false, signal, serverId)
          // A successful probe flips the stored status to `connected` server-side; if the
          // cached list still shows this server failed, refresh it so the row clears its red
          // state (and its tools stop being dropped) instead of waiting out the list stale-time.
          const cached = queryClient.getQueryData<McpServer[]>(mcpKeys.serversList(workspaceId))
          const status = cached?.find((s) => s.id === serverId)?.connectionStatus
          if (status && status !== 'connected') {
            queryClient.invalidateQueries(
              { queryKey: mcpKeys.serversList(workspaceId) },
              { cancelRefetch: false }
            )
          }
          return tools
        } catch (error) {
          await queryClient.invalidateQueries(
            { queryKey: mcpKeys.serversList(workspaceId) },
            { cancelRefetch: false }
          )
          throw error
        }
      },
      enabled: !!workspaceId,
      retry: false,
      staleTime: MCP_SERVER_TOOLS_STALE_TIME,
      refetchOnWindowFocus: false,
    })),
  })

  return useMemo(() => {
    const tools: McpTool[] = []
    let hasData = false
    let anyServerLoading = false
    let firstError: Error | null = null
    const statusById = new Map(servers?.map((s) => [s.id, s.connectionStatus]))
    const toolsStateByServer = new Map<
      string,
      { isLoading: boolean; isFetching: boolean; error: Error | null }
    >()
    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      const serverId = serverIds[index]
      const status = serverId ? statusById.get(serverId) : undefined
      const persistentlyFailed = status === 'error' || status === 'disconnected'
      // Keep last-known-good tools while the stored status is still `connected` (React Query
      // retains `data` across a failed refetch, so a populated server doesn't blank on a
      // transient probe error) — but drop them once the stored status leaves `connected`
      // (disconnected/error), so the workflow editor stops offering a dead server's stale tools.
      if (result.data && (!result.isError || !persistentlyFailed)) {
        tools.push(...result.data)
        hasData = true
      }
      if (result.isLoading) anyServerLoading = true
      if (!firstError && result.error instanceof Error) firstError = result.error

      if (serverId) {
        toolsStateByServer.set(serverId, {
          isLoading: result.isLoading,
          isFetching: result.isFetching,
          error: result.error instanceof Error ? result.error : null,
        })
      }
    }
    return {
      data: tools,
      isLoading: (serversLoading || anyServerLoading) && !hasData,
      isFetching: serversLoading || results.some((r) => r.isFetching),
      // Suppress when any healthy server rendered; per-server errors live in `toolsStateByServer`.
      error: hasData ? null : firstError,
      toolsStateByServer,
    }
  }, [results, serversLoading, serverIds, servers])
}

export function useForceRefreshMcpTools() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const allServers =
        queryClient.getQueryData<McpServer[]>(mcpKeys.serversList(workspaceId)) ?? []
      const servers = allServers.filter((server) =>
        isServerEligibleForDiscovery(server, workspaceId)
      )
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

/**
 * On `redirect`, the caller waits for the `mcp-oauth` BroadcastChannel signal (matched on
 * `state`) or `popup.closed`. `state` is the per-flow OAuth nonce the callback echoes, used to
 * correlate the eventual result back to this exact flow.
 */
export type StartMcpOauthMutationResult =
  | { status: 'redirect'; authorizationUrl: string; state: string }
  | { status: 'already_authorized' }

export function useStartMcpOauth() {
  return useMutation<StartMcpOauthMutationResult, Error, { serverId: string; workspaceId: string }>(
    {
      mutationFn: async ({ serverId, workspaceId }) => {
        // A stalled /oauth/start must settle so the caller can reset the connecting
        // state and close its pre-opened popup instead of appearing bricked.
        // Feature-detect AbortSignal.timeout (Safari <16 lacks it) with a plain
        // controller fallback.
        let timeoutSignal: AbortSignal | undefined
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        if (typeof AbortSignal.timeout === 'function') {
          timeoutSignal = AbortSignal.timeout(30_000)
        } else {
          const controller = new AbortController()
          timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), 30_000)
          timeoutSignal = controller.signal
        }
        let result: Awaited<ReturnType<typeof requestJson<typeof startMcpOauthContract>>>
        try {
          result = await requestJson(startMcpOauthContract, {
            query: { serverId, workspaceId },
            signal: timeoutSignal,
          })
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId)
        }
        if (result.status === 'already_authorized') return { status: 'already_authorized' }

        const parsedUrl = new URL(result.authorizationUrl)
        const isLoopbackHttp =
          parsedUrl.protocol === 'http:' && isLoopbackHostname(parsedUrl.hostname)
        if (parsedUrl.protocol !== 'https:' && !isLoopbackHttp) {
          throw new Error('Authorization URL must use HTTPS')
        }
        const state = parsedUrl.searchParams.get('state')
        if (!state) {
          throw new Error('Authorization URL is missing the OAuth state parameter')
        }
        // The popup itself is opened SYNCHRONOUSLY by the caller inside the user's
        // click (popup-first) — opening it here, after the network await, loses the
        // user activation and gets silently popup-blocked.
        return { status: 'redirect', authorizationUrl: result.authorizationUrl, state }
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
    staleTime: MCP_STORED_TOOL_LIST_STALE_TIME,
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

/** Per-workspace flag: has this session ever held a live SSE subscription for it? */
const SSE_SUBSCRIBED_KEY = '__mcp_sse_subscribed' as const
const sseEverSubscribed: Set<string> =
  ((globalThis as Record<string, unknown>)[SSE_SUBSCRIBED_KEY] as Set<string>) ??
  ((globalThis as Record<string, unknown>)[SSE_SUBSCRIBED_KEY] = new Set<string>())

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

      // EventSource fires `onopen` on the initial connect and on every auto-reconnect. Re-sync
      // the workspace whenever we could have missed a `tools_changed` event: on any reconnect,
      // and on the first open of a RE-subscription (leaving the tab tears the connection down,
      // so events fired while unsubscribed would otherwise be missed). Skip only the very first
      // subscription of the session — the queries fetch fresh on their own initial mount.
      const isResubscribe = sseEverSubscribed.has(workspaceId)
      sseEverSubscribed.add(workspaceId)
      let opened = false
      source.onopen = () => {
        if (opened || isResubscribe) invalidate()
        opened = true
      }

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
    staleTime: MCP_ALLOWED_DOMAINS_STALE_TIME,
  })
}
