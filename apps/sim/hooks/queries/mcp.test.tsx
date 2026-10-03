/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import {
  discoverMcpToolsContract,
  listManagedMcpCatalogContract,
  listMcpServersContract,
  type McpServer,
} from '@/lib/api/contracts/mcp'
import { useMcpToolServers, useMcpToolsQuery } from '@/hooks/queries/mcp'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

const WORKSPACE_ID = 'workspace-1'

function server(id: string, overrides: Partial<McpServer> = {}): McpServer {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: id,
    transport: 'streamable-http',
    url: `https://${id}.example.com/mcp`,
    enabled: true,
    connectionStatus: 'connected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderHookWithClient<T>(useHook: () => T): {
  getResult: () => T
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let result: T | undefined

  function Probe() {
    result = useHook()
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    unmount: () => act(() => root.unmount()),
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

function mockServers(servers: McpServer[]) {
  mockRequestJson.mockImplementation(async (contract) => {
    if (contract === listMcpServersContract) {
      return { success: true, data: { servers } }
    }
    if (contract === discoverMcpToolsContract) {
      return { success: true, data: { tools: [], totalCount: 0, byServer: {} } }
    }
    if (contract === listManagedMcpCatalogContract) return { servers: [], tools: [] }
    throw new Error('Unexpected MCP request')
  })
}

// jsdom has no EventSource; useMcpToolsQuery mounts the shared SSE subscription.
class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

describe('useMcpToolServers', () => {
  it('includes allowed managed connections alongside ordinary servers', async () => {
    const sharedServer = server('shared-server')
    const managedServer = server('mcp-cg-123456789012345678901', {
      name: 'Fireflies — person@example.com',
      managedConnectorId: 'fireflies',
      authType: 'oauth',
      url: undefined,
    })
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listMcpServersContract) {
        return { success: true, data: { servers: [sharedServer] } }
      }
      if (contract === listManagedMcpCatalogContract) return { servers: [managedServer], tools: [] }
      throw new Error('Unexpected MCP request')
    })

    const hook = renderHookWithClient(() => useMcpToolServers(WORKSPACE_ID))
    await flush()

    expect(hook.getResult()).toEqual({
      data: [sharedServer, managedServer],
      isLoading: false,
      error: null,
    })
    hook.unmount()
  })
})

describe('useMcpToolsQuery', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource
  })

  afterEach(() => {
    // mcp.ts captured these Map/Set instances in module consts at import, so reassigning the
    // globalThis property wouldn't reset what the module uses — clear the shared instances.
    ;(
      globalThis as unknown as { __mcp_sse_connections?: Map<string, unknown> }
    ).__mcp_sse_connections?.clear()
    ;(globalThis as unknown as { __mcp_sse_subscribed?: Set<string> }).__mcp_sse_subscribed?.clear()
  })

  it('does not auto-discover disconnected or errored OAuth servers', async () => {
    mockServers([
      server('oauth-disconnected', { authType: 'oauth', connectionStatus: 'disconnected' }),
      server('oauth-error', { authType: 'oauth', connectionStatus: 'error' }),
    ])

    const { unmount } = renderHookWithClient(() => useMcpToolsQuery(WORKSPACE_ID))
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson).toHaveBeenCalledWith(
      listMcpServersContract,
      expect.objectContaining({ query: { workspaceId: WORKSPACE_ID } })
    )

    unmount()
  })

  it('keeps last-known-good tools when a later discovery refetch fails', async () => {
    let discoverCalls = 0
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listMcpServersContract) {
        return {
          success: true,
          data: { servers: [server('s1', { authType: 'headers', connectionStatus: 'connected' })] },
        }
      }
      if (contract === discoverMcpToolsContract) {
        discoverCalls++
        if (discoverCalls === 1) {
          return { success: true, data: { tools: [{ name: 'tool-a', serverId: 's1' }] } }
        }
        throw new Error('transient stall')
      }
      throw new Error('Unexpected MCP request')
    })

    const { getResult, unmount } = renderHookWithClient(() => ({
      tools: useMcpToolsQuery(WORKSPACE_ID),
      queryClient: useQueryClient(),
    }))
    await flush()
    expect(getResult().tools.data).toHaveLength(1)

    // Force a refetch that fails; the last successful tools must survive.
    await act(async () => {
      await getResult().queryClient.invalidateQueries({
        queryKey: mcpKeys.serverToolsList(WORKSPACE_ID, 's1'),
      })
    })
    await flush()

    expect(getResult().tools.data).toHaveLength(1)
    expect(getResult().tools.toolsStateByServer.get('s1')?.error).toBeInstanceOf(Error)

    unmount()
  })

  it('drops stale tools once a non-OAuth server is persistently failed', async () => {
    let discoverCalls = 0
    let listCalls = 0
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listMcpServersContract) {
        listCalls++
        // Healthy on first read, error state after the failed refetch invalidates the list.
        const connectionStatus = listCalls === 1 ? 'connected' : 'error'
        return {
          success: true,
          data: { servers: [server('s1', { authType: 'headers', connectionStatus })] },
        }
      }
      if (contract === discoverMcpToolsContract) {
        discoverCalls++
        if (discoverCalls === 1) {
          return { success: true, data: { tools: [{ name: 'tool-a', serverId: 's1' }] } }
        }
        throw new Error('persistent failure')
      }
      throw new Error('Unexpected MCP request')
    })

    const { getResult, unmount } = renderHookWithClient(() => ({
      tools: useMcpToolsQuery(WORKSPACE_ID),
      queryClient: useQueryClient(),
    }))
    await flush()
    expect(getResult().tools.data).toHaveLength(1)

    await act(async () => {
      await getResult().queryClient.invalidateQueries({
        queryKey: mcpKeys.serverToolsList(WORKSPACE_ID, 's1'),
      })
    })
    await flush()

    // Stored status is now 'error' → the dead server's stale tools are dropped from the aggregate.
    expect(getResult().tools.data).toHaveLength(0)

    unmount()
  })
})
