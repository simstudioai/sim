/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { useMcpToolsQuery } from '@/hooks/queries/mcp'

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

function renderHookWithClient<T>(useHook: () => T): { unmount: () => void } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)

  function Probe() {
    useHook()
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

  return { unmount: () => act(() => root.unmount()) }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(0)
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
})
