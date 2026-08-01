/**
 * @vitest-environment node
 *
 * Public v2 MCP server detail: gate ordering, contract validation, workspace
 * access, and the thin-wrapper mapping onto `lib/mcp/orchestration`.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerRow } from '@/lib/mcp/queries'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetWorkspaceMcpServer,
  mockPerformUpdateMcpServer,
  mockPerformDeleteMcpServer,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetWorkspaceMcpServer: vi.fn(),
  mockPerformUpdateMcpServer: vi.fn(),
  mockPerformDeleteMcpServer: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/mcp/queries', () => ({
  getWorkspaceMcpServer: mockGetWorkspaceMcpServer,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performUpdateMcpServer: mockPerformUpdateMcpServer,
  performDeleteMcpServer: mockPerformDeleteMcpServer,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/mcp-servers/[id]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

function buildRow(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: 'mcp-abc12345',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'Docs server',
    description: null,
    transport: 'streamable-http',
    url: 'https://mcp.example.com/sse',
    authType: 'headers',
    oauthClientId: null,
    oauthClientSecret: 'encrypted-secret',
    headers: { Authorization: 'Bearer super-secret-token' },
    timeout: 30000,
    retries: 3,
    enabled: true,
    lastConnected: null,
    connectionStatus: 'disconnected',
    lastError: null,
    statusConfig: {},
    toolCount: 0,
    lastToolsRefresh: null,
    totalRequests: 0,
    lastUsed: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  } as McpServerRow
}

const routeContext = () => ({ params: Promise.resolve({ id: 'mcp-abc12345' }) })

const url = (query = 'workspaceId=workspace-1') =>
  `http://localhost:3000/api/v2/mcp-servers/mcp-abc12345?${query}`

function callGet(query?: string) {
  return GET(new NextRequest(url(query)), routeContext())
}

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/mcp-servers/mcp-abc12345', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

function callDelete(query?: string) {
  return DELETE(new NextRequest(url(query), { method: 'DELETE' }), routeContext())
}

describe('GET /api/v2/mcp-servers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceMcpServer.mockResolvedValue(buildRow())
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockGetWorkspaceMcpServer).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockGetWorkspaceMcpServer).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mockGetWorkspaceMcpServer).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the server does not exist in the workspace', async () => {
    mockGetWorkspaceMcpServer.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the public server shape without header values', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.mcpServer).toMatchObject({
      id: 'mcp-abc12345',
      hasHeaders: true,
      headerNames: ['Authorization'],
      hasOauthClientSecret: true,
    })
    expect(JSON.stringify(body)).not.toContain('super-secret-token')
    expect(JSON.stringify(body)).not.toContain('encrypted-secret')
    expect(mockGetWorkspaceMcpServer).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      serverId: 'mcp-abc12345',
    })
  })
})

describe('PATCH /api/v2/mcp-servers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformUpdateMcpServer.mockResolvedValue({ success: true, server: buildRow() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ workspaceId: 'workspace-1', name: 'Renamed' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdateMcpServer).not.toHaveBeenCalled()
  })

  it('400s when the body has an unknown field', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', bogus: true })
    expect(res.status).toBe(400)
    expect(mockPerformUpdateMcpServer).not.toHaveBeenCalled()
  })

  it('400s when the url carries an environment-variable template', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', url: 'https://{{HOST}}/sse' })
    expect(res.status).toBe(400)
    expect(mockPerformUpdateMcpServer).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', name: 'Renamed' })
    expect(res.status).toBe(403)
    expect(mockPerformUpdateMcpServer).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', name: 'Renamed' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('maps a not_found orchestration failure to 404', async () => {
    mockPerformUpdateMcpServer.mockResolvedValue({
      success: false,
      error: 'Server not found',
      errorCode: 'not_found',
    })
    const res = await callPatch({ workspaceId: 'workspace-1', name: 'Renamed' })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('400s when the url is changed, since the id is derived from it', async () => {
    mockGetWorkspaceMcpServer.mockResolvedValue(buildRow())

    const res = await callPatch({
      workspaceId: 'workspace-1',
      url: 'https://different.example.com/sse',
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('url cannot be changed')
    expect(mockPerformUpdateMcpServer).not.toHaveBeenCalled()
  })

  it('allows a url that matches the stored one, so a full-object PATCH still works', async () => {
    mockGetWorkspaceMcpServer.mockResolvedValue(buildRow())

    const res = await callPatch({
      workspaceId: 'workspace-1',
      url: 'https://mcp.example.com/sse',
      enabled: false,
    })

    expect(res.status).toBe(200)
    expect(mockPerformUpdateMcpServer).toHaveBeenCalled()
  })

  it('updates the server and returns the public shape', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', name: 'Renamed', enabled: false })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.mcpServer.id).toBe('mcp-abc12345')
    expect(body.data.mcpServer.headers).toBeUndefined()
    expect(mockPerformUpdateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        serverId: 'mcp-abc12345',
        name: 'Renamed',
        enabled: false,
      })
    )
  })
})

describe('DELETE /api/v2/mcp-servers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformDeleteMcpServer.mockResolvedValue({ success: true, server: buildRow() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockPerformDeleteMcpServer).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDelete('')
    expect(res.status).toBe(400)
    expect(mockPerformDeleteMcpServer).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(403)
    expect(mockPerformDeleteMcpServer).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('maps a not_found orchestration failure to 404', async () => {
    mockPerformDeleteMcpServer.mockResolvedValue({
      success: false,
      error: 'Server not found',
      errorCode: 'not_found',
    })
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('deletes the server and acknowledges the id', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 'mcp-abc12345', deleted: true } })
    expect(mockPerformDeleteMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        serverId: 'mcp-abc12345',
      })
    )
  })
})
