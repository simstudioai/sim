/**
 * @vitest-environment node
 */
import { mcpServers } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCanWrite, mockPerformDeleteMcpServer } = vi.hoisted(() => ({
  mockCanWrite: vi.fn(),
  mockPerformDeleteMcpServer: vi.fn(),
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
          canWrite: boolean
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
        canWrite: mockCanWrite(),
        requestId: 'request-1',
      }),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: vi.fn(),
  performDeleteMcpServer: mockPerformDeleteMcpServer,
}))

import { DELETE, GET } from '@/app/api/mcp/servers/route'

function createListRequest() {
  return new Request('http://localhost:3000/api/mcp/servers?workspaceId=workspace-1', {
    method: 'GET',
  }) as NextRequest
}

function createDeleteRequest(serverId = 'server-1') {
  return new Request(
    `http://localhost:3000/api/mcp/servers?workspaceId=workspace-1&serverId=${serverId}`,
    { method: 'DELETE' }
  ) as NextRequest
}

describe('MCP servers DELETE route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
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

describe('MCP servers GET route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCanWrite.mockReturnValue(false)
    queueTableRows(mcpServers, [
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Private server',
        headers: { Authorization: 'Bearer secret-token' },
        oauthClientSecret: 'oauth-secret',
      },
    ])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('does not expose authentication header values to read-only users', async () => {
    const response = await GET(createListRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.servers[0]).not.toHaveProperty('headers')
    expect(body.data.servers[0]).not.toHaveProperty('oauthClientSecret')
    expect(body.data.servers[0].hasOauthClientSecret).toBe(true)
  })

  it('retains configured headers for users who can manage the server', async () => {
    mockCanWrite.mockReturnValue(true)

    const response = await GET(createListRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.servers[0].headers).toEqual({ Authorization: 'Bearer secret-token' })
  })
})
