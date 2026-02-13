/**
 * Tests for MCP serve route auth propagation.
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockGenerateInternalToken = vi.fn()
const mockDbSelect = vi.fn()
const mockDbFrom = vi.fn()
const mockDbWhere = vi.fn()
const mockDbLimit = vi.fn()
const fetchMock = vi.fn()

describe('MCP Serve Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })

    vi.doMock('@sim/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))
    vi.doMock('drizzle-orm', () => ({
      and: vi.fn(),
      eq: vi.fn(),
    }))
    vi.doMock('@sim/db', () => ({
      db: {
        select: mockDbSelect,
      },
    }))
    vi.doMock('@sim/db/schema', () => ({
      workflowMcpServer: {
        id: 'id',
        name: 'name',
        workspaceId: 'workspaceId',
        isPublic: 'isPublic',
        createdBy: 'createdBy',
      },
      workflowMcpTool: {
        serverId: 'serverId',
        toolName: 'toolName',
        toolDescription: 'toolDescription',
        parameterSchema: 'parameterSchema',
        workflowId: 'workflowId',
      },
      workflow: {
        id: 'id',
        isDeployed: 'isDeployed',
      },
    }))
    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: mockCheckHybridAuth,
    }))
    vi.doMock('@/lib/workspaces/permissions/utils', () => ({
      getUserEntityPermissions: mockGetUserEntityPermissions,
    }))
    vi.doMock('@/lib/auth/internal', () => ({
      generateInternalToken: mockGenerateInternalToken,
    }))
    vi.doMock('@/lib/core/utils/urls', () => ({
      getBaseUrl: () => 'http://localhost:3000',
      getInternalApiBaseUrl: () => 'http://localhost:3000',
    }))
    vi.doMock('@/lib/core/execution-limits', () => ({
      getMaxExecutionTimeout: () => 10_000,
    }))

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns 401 for private server when auth fails', async () => {
    mockDbLimit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    mockCheckHybridAuth.mockResolvedValueOnce({ success: false, error: 'Unauthorized' })

    const { POST } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 401 on GET for private server when auth fails', async () => {
    mockDbLimit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    mockCheckHybridAuth.mockResolvedValueOnce({ success: false, error: 'Unauthorized' })

    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1')
    const response = await GET(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('forwards X-API-Key for private server api_key auth', async () => {
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Private Server',
          workspaceId: 'ws-1',
          isPublic: false,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])

    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    mockGetUserEntityPermissions.mockResolvedValueOnce('write')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ output: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { POST } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { 'X-API-Key': 'pk_test_123' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
    const headers = fetchOptions.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('pk_test_123')
    expect(headers.Authorization).toBeUndefined()
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
  })

  it('forwards internal token for private server session auth', async () => {
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Private Server',
          workspaceId: 'ws-1',
          isPublic: false,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])

    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValueOnce('read')
    mockGenerateInternalToken.mockResolvedValueOnce('internal-token-user-1')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ output: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { POST } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a' },
      }),
    })
    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
    const headers = fetchOptions.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer internal-token-user-1')
    expect(headers['X-API-Key']).toBeUndefined()
    expect(mockGenerateInternalToken).toHaveBeenCalledWith('user-1')
  })
})
