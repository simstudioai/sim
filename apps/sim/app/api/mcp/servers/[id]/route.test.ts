/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformUpdateMcpServer } = vi.hoisted(() => ({
  mockPerformUpdateMcpServer: vi.fn(),
}))

vi.mock('@/lib/mcp/middleware', () => ({
  getParsedBody: () => undefined,
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  mcpBodyReadErrorResponse: () => null,
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: Record<string, string>,
        routeContext: { params: Promise<{ id: string }> }
      ) => Promise<Response>
    ) =>
    (request: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        request,
        {
          userId: 'user-1',
          userName: 'Test User',
          userEmail: 'test@example.com',
          workspaceId: 'workspace-1',
          requestId: 'request-1',
          permission: 'admin',
        },
        routeContext
      ),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performUpdateMcpServer: mockPerformUpdateMcpServer,
  mcpOrchestrationStatus: () => 500,
}))

import { PATCH } from '@/app/api/mcp/servers/[id]/route'

const SECRET_HEADER_VALUE = 'Bearer super-secret-upstream-token'

function updateRequest() {
  return new Request('http://localhost:3000/api/mcp/servers/server-1?workspaceId=workspace-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed' }),
  }) as NextRequest
}

describe('MCP server PATCH route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('echoes the updated server without header values or the client secret', async () => {
    mockPerformUpdateMcpServer.mockResolvedValueOnce({
      success: true,
      server: {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Renamed',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        headers: { Authorization: SECRET_HEADER_VALUE },
        enabled: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        oauthClientSecret: 'encrypted-secret',
      },
    })

    const response = await PATCH(updateRequest(), { params: Promise.resolve({ id: 'server-1' }) })
    const body = await response.json()

    expect(JSON.stringify(body)).not.toContain(SECRET_HEADER_VALUE)
    expect(body.data.server.headers).toBeUndefined()
    expect(body.data.server.hasHeaders).toBe(true)
    expect(body.data.server.headerNames).toEqual(['Authorization'])
    expect(body.data.server.oauthClientSecret).toBeUndefined()
    expect(body.data.server.hasOauthClientSecret).toBe(true)
  })
})
