/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import {
  discoverMcpToolsContract,
  listMcpServersContract,
  type McpServer,
} from '@/lib/api/contracts/mcp'
import {
  mcpKeys,
  useForceRefreshMcpTools,
  useMcpServers,
  useMcpToolsQuery,
} from '@/hooks/queries/mcp'

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
    throw new Error('Unexpected MCP request')
  })
}

describe('useMcpToolsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not auto-discover disconnected or errored OAuth servers', async () => {
    mockServers([
      server('oauth-disconnected', { authType: 'oauth', connectionStatus: 'disconnected' }),
      server('oauth-error', { authType: 'oauth', connectionStatus: 'error' }),
    ])

    const { unmount } = renderHookWithClient(() => useMcpToolsQuery(WORKSPACE_ID))
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    expect(mockRequestJson).toHaveBeenCalledWith(
      listMcpServersContract,
      expect.objectContaining({ query: { workspaceId: WORKSPACE_ID } })
    )

    unmount()
  })

  it('continues discovering connected OAuth and disconnected non-OAuth servers', async () => {
    mockServers([
      server('oauth-connected', { authType: 'oauth', connectionStatus: 'connected' }),
      server('headers-disconnected', { authType: 'headers', connectionStatus: 'disconnected' }),
    ])

    const { unmount } = renderHookWithClient(() => useMcpToolsQuery(WORKSPACE_ID))
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(3)
    expect(mockRequestJson).toHaveBeenCalledWith(
      discoverMcpToolsContract,
      expect.objectContaining({
        query: { workspaceId: WORKSPACE_ID, serverId: 'oauth-connected' },
      })
    )
    expect(mockRequestJson).toHaveBeenCalledWith(
      discoverMcpToolsContract,
      expect.objectContaining({
        query: { workspaceId: WORKSPACE_ID, serverId: 'headers-disconnected' },
      })
    )

    unmount()
  })

  it('refreshes the server list after a connected OAuth discovery fails', async () => {
    let serverListRequests = 0
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listMcpServersContract) {
        serverListRequests++
        const connectionStatus = serverListRequests === 1 ? 'connected' : 'disconnected'
        return {
          success: true,
          data: {
            servers: [server('oauth-server', { authType: 'oauth', connectionStatus })],
          },
        }
      }
      if (contract === discoverMcpToolsContract) {
        throw new Error('OAuth authorization required')
      }
      throw new Error('Unexpected MCP request')
    })

    const { unmount } = renderHookWithClient(() => useMcpToolsQuery(WORKSPACE_ID))
    await flush()

    expect(serverListRequests).toBe(2)
    expect(
      mockRequestJson.mock.calls.filter(([contract]) => contract === discoverMcpToolsContract)
    ).toHaveLength(1)

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

  it('does not force-refresh disconnected OAuth servers', async () => {
    mockServers([
      server('oauth-disconnected', { authType: 'oauth', connectionStatus: 'disconnected' }),
      server('headers-connected', { authType: 'headers', connectionStatus: 'connected' }),
    ])

    const { getResult, unmount } = renderHookWithClient(() => ({
      servers: useMcpServers(WORKSPACE_ID),
      refresh: useForceRefreshMcpTools(),
    }))
    await flush()

    await act(async () => {
      await getResult().refresh.mutateAsync(WORKSPACE_ID)
    })

    const discoveryCalls = mockRequestJson.mock.calls.filter(
      ([contract]) => contract === discoverMcpToolsContract
    )
    expect(discoveryCalls).toHaveLength(1)
    expect(discoveryCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        query: { workspaceId: WORKSPACE_ID, refresh: true, serverId: 'headers-connected' },
      })
    )

    unmount()
  })
})
