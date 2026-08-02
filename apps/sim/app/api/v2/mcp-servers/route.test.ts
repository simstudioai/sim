/**
 * @vitest-environment node
 *
 * Public v2 MCP servers list/create: gate ordering, contract validation, the
 * write-only `headers` projection, and the 409-on-duplicate-URL departure from
 * the internal upsert.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerRow } from '@/lib/mcp/queries'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockListWorkspaceMcpServers,
  mockGetWorkspaceMcpServer,
  mockGetMcpServerIdState,
  mockPerformCreateMcpServer,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockListWorkspaceMcpServers: vi.fn(),
  mockGetWorkspaceMcpServer: vi.fn(),
  mockGetMcpServerIdState: vi.fn(),
  mockPerformCreateMcpServer: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/mcp/queries', () => ({
  listWorkspaceMcpServers: mockListWorkspaceMcpServers,
  getWorkspaceMcpServer: mockGetWorkspaceMcpServer,
  getMcpServerIdState: mockGetMcpServerIdState,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: mockPerformCreateMcpServer,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/mcp-servers/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function buildRow(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: 'mcp-abc12345',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'Docs server',
    description: 'Internal docs',
    transport: 'streamable-http',
    url: 'https://mcp.example.com/sse',
    authType: 'headers',
    oauthClientId: null,
    oauthClientSecret: null,
    headers: { Authorization: 'Bearer super-secret-token' },
    timeout: 30000,
    retries: 3,
    enabled: true,
    lastConnected: new Date('2024-01-02T00:00:00Z'),
    connectionStatus: 'connected',
    lastError: null,
    statusConfig: {},
    toolCount: 4,
    lastToolsRefresh: new Date('2024-01-02T00:00:00Z'),
    totalRequests: 0,
    lastUsed: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  } as McpServerRow
}

function callList(query: string) {
  return GET(new NextRequest(`http://localhost:3000/api/v2/mcp-servers?${query}`))
}

function callCreate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/mcp-servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

/** What the route forwards for a bare `?workspaceId=` list. */
const DEFAULT_LIST_ARGS = {
  search: undefined,
  sortBy: 'createdAt',
  sortOrder: 'desc',
}

const VALID_BODY = {
  workspaceId: 'workspace-1',
  name: 'Docs server',
  url: 'https://mcp.example.com/sse',
}

describe('GET /api/v2/mcp-servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListWorkspaceMcpServers.mockResolvedValue([buildRow()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList('workspaceId=workspace-1')

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockListWorkspaceMcpServers).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListWorkspaceMcpServers).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'FORBIDDEN', message: 'Access denied' })
    expect(mockListWorkspaceMcpServers).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2024-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public server shape in the cursor envelope', async () => {
    const res = await callList('workspaceId=workspace-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'mcp-abc12345',
        name: 'Docs server',
        description: 'Internal docs',
        transport: 'streamable-http',
        authType: 'headers',
        url: 'https://mcp.example.com/sse',
        timeout: 30000,
        retries: 3,
        enabled: true,
        connectionStatus: 'connected',
        lastError: null,
        toolCount: 4,
        lastToolsRefresh: '2024-01-02T00:00:00.000Z',
        lastConnected: '2024-01-02T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        hasHeaders: true,
        headerNames: ['Authorization'],
        hasOauthClientSecret: false,
      },
    ])
    expect(mockListWorkspaceMcpServers).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      ...DEFAULT_LIST_ARGS,
    })
  })

  it('never returns configured header values', async () => {
    const res = await callList('workspaceId=workspace-1')
    const raw = JSON.stringify(await res.json())

    expect(raw).not.toContain('super-secret-token')
    expect(raw).not.toContain('"headers":')
  })
  it('400s on a sort field outside the enum instead of letting it reach the query', async () => {
    const res = await callList(`workspaceId=workspace-1&sortBy=name);--`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
  })

  it('400s on a sort direction outside the enum', async () => {
    const res = await callList(`workspaceId=workspace-1&sortOrder=sideways`)

    expect(res.status).toBe(400)
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=workspace-1&search=`)

    expect(res.status).toBe(400)
  })

  it('forwards search and sort into the query and still terminates pagination', async () => {
    const res = await callList(`workspaceId=workspace-1&search=report&sortBy=name&sortOrder=asc`)

    expect(res.status).toBe(200)
    expect((await res.json()).nextCursor).toBeNull()
  })
})

describe('POST /api/v2/mcp-servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetMcpServerIdState.mockResolvedValue(null)
    mockPerformCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-abc12345',
      updated: false,
    })
    mockGetWorkspaceMcpServer.mockResolvedValue(buildRow())
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('400s when the body is missing a required field', async () => {
    const res = await callCreate({ workspaceId: 'workspace-1', name: 'Docs server' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('400s when the url carries an environment-variable template', async () => {
    const res = await callCreate({ ...VALID_BODY, url: 'https://{{MCP_HOST}}/sse' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('{{ENV_VAR}}')
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('400s when the url is not an absolute http(s) URL', async () => {
    const res = await callCreate({ ...VALID_BODY, url: 'file:///etc/passwd' })
    expect(res.status).toBe(400)
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2024-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('409s on a duplicate URL without letting the lib upsert', async () => {
    mockGetMcpServerIdState.mockResolvedValue({ deleted: false })

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
    expect(mockPerformCreateMcpServer).not.toHaveBeenCalled()
  })

  it('409s when a concurrent create made the lib upsert instead of insert', async () => {
    mockPerformCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-abc12345',
      updated: true,
    })

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('revives a soft-deleted URL instead of stranding it behind a 409', async () => {
    mockGetMcpServerIdState.mockResolvedValue({ deleted: true })
    mockPerformCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-abc12345',
      updated: true,
    })

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(201)
    expect(mockPerformCreateMcpServer).toHaveBeenCalled()
  })

  it('creates the server and returns 201 with the public shape', async () => {
    const res = await callCreate({ ...VALID_BODY, headers: { Authorization: 'Bearer tok' } })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.mcpServer).toMatchObject({
      id: 'mcp-abc12345',
      name: 'Docs server',
      hasHeaders: true,
      headerNames: ['Authorization'],
    })
    expect(body.data.mcpServer.headers).toBeUndefined()
    expect(mockPerformCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Docs server',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer tok' },
      })
    )
  })
})
