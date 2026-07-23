/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClearCache, mockDiscoverServerTools } = vi.hoisted(() => ({
  mockClearCache: vi.fn(),
  mockDiscoverServerTools: vi.fn(),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/mcp/middleware', () => ({
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: { userId: string; workspaceId: string; requestId: string },
        routeContext: { params: Promise<{ id: string }> }
      ) => Promise<Response>
    ) =>
    (request: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        request,
        { userId: 'user-1', workspaceId: 'workspace-1', requestId: 'request-1' },
        routeContext
      ),
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    clearCache: mockClearCache,
    discoverServerTools: mockDiscoverServerTools,
  },
}))

import { POST } from '@/app/api/mcp/servers/[id]/refresh/route'

const initialServer = {
  id: 'server-1',
  workspaceId: 'workspace-1',
  name: 'OAuth Server',
  url: 'https://example.com/mcp',
  connectionStatus: 'connected',
  lastError: null,
  lastConnected: new Date('2026-01-01T00:00:00.000Z'),
  toolCount: 4,
  statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
}

const persistedServer = {
  ...initialServer,
  connectionStatus: 'disconnected',
  lastError: null,
  toolCount: 0,
}

describe('MCP server refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce([initialServer])
    dbChainMockFns.returning.mockResolvedValue([persistedServer])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('preserves the service-persisted OAuth pending status', async () => {
    mockDiscoverServerTools.mockRejectedValueOnce(new Error('OAuth authorization required'))

    const request = new Request('http://localhost/api/mcp/servers/server-1/refresh', {
      method: 'POST',
    }) as NextRequest
    const response = await POST(request, { params: Promise.resolve({ id: 'server-1' }) })
    const body = await response.json()

    expect(body.data).toEqual(
      expect.objectContaining({
        status: 'disconnected',
        error: null,
      })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: expect.anything() })
    )
  })

  it('reports the discovery failure when status persistence leaves a stale connected row', async () => {
    const reflectedSecret = 'Bearer reflected-static-token'
    mockDiscoverServerTools.mockRejectedValueOnce(
      new Error(`Upstream reflected ${reflectedSecret}`)
    )
    dbChainMockFns.returning.mockResolvedValueOnce([initialServer])

    const request = new Request('http://localhost/api/mcp/servers/server-1/refresh', {
      method: 'POST',
    }) as NextRequest
    const response = await POST(request, { params: Promise.resolve({ id: 'server-1' }) })
    const body = await response.json()

    expect(body.data).toEqual(
      expect.objectContaining({
        status: 'disconnected',
        error: 'Internal server error',
        workflowsUpdated: 0,
      })
    )
    expect(JSON.stringify(body)).not.toContain(reflectedSecret)
    expect(mockClearCache).not.toHaveBeenCalled()
  })

  it('preserves a connected status from a newer successful discovery', async () => {
    mockDiscoverServerTools.mockRejectedValueOnce(new Error('Connection failed'))
    const newerSuccessfulServer = {
      ...initialServer,
      lastConnected: new Date(Date.now() + 60_000),
      toolCount: 7,
    }
    dbChainMockFns.returning.mockResolvedValueOnce([newerSuccessfulServer])

    const request = new Request('http://localhost/api/mcp/servers/server-1/refresh', {
      method: 'POST',
    }) as NextRequest
    const response = await POST(request, { params: Promise.resolve({ id: 'server-1' }) })
    const body = await response.json()

    expect(body.data).toEqual(
      expect.objectContaining({
        status: 'connected',
        error: null,
        toolCount: 7,
        workflowsUpdated: 0,
      })
    )
    expect(mockClearCache).toHaveBeenCalledWith('workspace-1')
  })

  it('does not 500 when workflow sync fails after a successful discovery', async () => {
    mockDiscoverServerTools.mockResolvedValueOnce([
      {
        name: 'search',
        description: 'Search tool',
        inputSchema: {},
        serverId: 'server-1',
        serverName: 'OAuth Server',
      },
    ])
    // The route's server lookup consumes the first from() (verbatim mini-builder);
    // the sync's workflow select then throws — exercising the guard that keeps a
    // secondary sync failure from turning a successful refresh into a 500.
    dbChainMockFns.from
      .mockImplementationOnce(() => ({
        where: () => ({ limit: () => Promise.resolve([initialServer]) }),
      }))
      .mockImplementationOnce(() => {
        throw new Error('workflow select unavailable')
      })
    dbChainMockFns.returning.mockResolvedValueOnce([initialServer])

    const request = new Request('http://localhost/api/mcp/servers/server-1/refresh', {
      method: 'POST',
    }) as NextRequest
    const response = await POST(request, { params: Promise.resolve({ id: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(
      expect.objectContaining({
        status: 'connected',
        workflowsUpdated: 0,
        updatedWorkflowIds: [],
      })
    )
  })
})
