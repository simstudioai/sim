/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDiscoverServerTools, mockSelect, mockUpdateSet } = vi.hoisted(() => ({
  mockDiscoverServerTools: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdateSet: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
  },
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
    clearCache: vi.fn(),
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

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  }
}

describe('MCP server refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValueOnce(selectRows([initialServer]))
    mockUpdateSet.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([persistedServer]) }),
    })
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
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: expect.anything() })
    )
  })
})
