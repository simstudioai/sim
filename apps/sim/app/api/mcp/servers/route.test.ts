/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformDeleteMcpServer, authState } = vi.hoisted(() => ({
  mockPerformDeleteMcpServer: vi.fn(),
  authState: { permission: 'read' as string },
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
          permission: string
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
        permission: authState.permission,
      }),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: vi.fn(),
  performDeleteMcpServer: mockPerformDeleteMcpServer,
}))

import { DELETE, GET } from '@/app/api/mcp/servers/route'

const SECRET_HEADER_VALUE = 'Bearer super-secret-upstream-token'

function serverRow() {
  return {
    id: 'server-1',
    workspaceId: 'workspace-1',
    name: 'Internal MCP',
    description: null,
    transport: 'streamable-http',
    url: 'https://mcp.example.com',
    headers: { Authorization: SECRET_HEADER_VALUE, 'X-Api-Key': 'k-123' },
    timeout: 30000,
    retries: 3,
    enabled: true,
    connectionStatus: 'connected',
    lastError: null,
    statusConfig: null,
    toolCount: 2,
    lastToolsRefresh: null,
    lastConnected: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    authType: 'headers',
    oauthClientId: 'client-1',
    oauthClientSecret: 'encrypted-secret',
  }
}

function listRequest() {
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

describe('MCP servers GET route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authState.permission = 'read'
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('never returns header values to a read-only member, only their names', async () => {
    queueTableRows(schemaMock.mcpServers, [serverRow()])

    const response = await GET(listRequest())
    const body = await response.json()
    const [server] = body.data.servers

    expect(JSON.stringify(body)).not.toContain(SECRET_HEADER_VALUE)
    expect(JSON.stringify(body)).not.toContain('k-123')
    expect(server.headers).toBeUndefined()
    expect(server.hasHeaders).toBe(true)
    expect(server.headerNames).toEqual(['Authorization', 'X-Api-Key'])
    expect(server.oauthClientSecret).toBeUndefined()
    expect(server.hasOauthClientSecret).toBe(true)
  })

  it('reports absent headers without inventing names', async () => {
    queueTableRows(schemaMock.mcpServers, [{ ...serverRow(), headers: null }])

    const response = await GET(listRequest())
    const [server] = (await response.json()).data.servers

    expect(server.hasHeaders).toBe(false)
    expect(server.headerNames).toEqual([])
  })

  it('still serves header values to an editor, who round-trips them on save', async () => {
    authState.permission = 'write'
    queueTableRows(schemaMock.mcpServers, [serverRow()])

    const response = await GET(listRequest())
    const [server] = (await response.json()).data.servers

    expect(server.headers).toEqual({ Authorization: SECRET_HEADER_VALUE, 'X-Api-Key': 'k-123' })
    expect(server.oauthClientSecret).toBeUndefined()
  })
})

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
