/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformDeleteMcpServer } = vi.hoisted(() => ({
  mockPerformDeleteMcpServer: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/lib/mcp/middleware', () => ({
  getParsedBody: () => undefined,
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: {
          userId: string
          userName: string
          userEmail: string
          workspaceId: string
          requestId: string
        }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        userName: 'Test User',
        userEmail: 'test@example.com',
        workspaceId: 'workspace-1',
        requestId: 'request-1',
      }),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: vi.fn(),
  performDeleteMcpServer: mockPerformDeleteMcpServer,
}))

import { DELETE } from '@/app/api/mcp/servers/route'

function createDeleteRequest(serverId = 'server-1') {
  return new Request(
    `http://localhost:3000/api/mcp/servers?workspaceId=workspace-1&serverId=${serverId}`,
    { method: 'DELETE' }
  ) as NextRequest
}

describe('MCP servers DELETE route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when orchestration reports a missing server', async () => {
    mockPerformDeleteMcpServer.mockResolvedValueOnce({
      success: false,
      error: 'Server not found',
      errorCode: 'not_found',
    })

    const response = await DELETE(createDeleteRequest())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ success: false, error: 'Server not found' })
  })

  it('returns 500 when orchestration reports an internal delete failure', async () => {
    mockPerformDeleteMcpServer.mockResolvedValueOnce({
      success: false,
      error: 'Failed to delete MCP server',
      errorCode: 'internal',
    })

    const response = await DELETE(createDeleteRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'Failed to delete MCP server' })
  })
})
