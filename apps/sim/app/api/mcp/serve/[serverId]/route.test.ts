/**
 * Tests for MCP serve route auth propagation.
 *
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateInternalToken, fetchMock } = vi.hoisted(() => ({
  mockGenerateInternalToken: vi.fn(),
  fetchMock: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mockGenerateInternalToken,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'http://localhost:3000',
  getInternalApiBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/core/execution-limits', () => ({
  getMaxExecutionTimeout: () => 10_000,
}))

import { GET, POST } from '@/app/api/mcp/serve/[serverId]/route'

describe('MCP Serve Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for private server when auth fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 401 on GET for private server when auth fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1')
    const response = await GET(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('forwards X-API-Key for private server api_key auth', async () => {
    dbChainMockFns.limit
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

    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
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
    dbChainMockFns.limit
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

    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
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

  describe('initialize protocol version negotiation', () => {
    async function callInitialize(protocolVersion?: string) {
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      const params: Record<string, unknown> = {
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      }
      if (protocolVersion !== undefined) params.protocolVersion = protocolVersion
      const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params }),
      })
      const res = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
      return res.json() as Promise<{ result: { protocolVersion: string } }>
    }

    it('echoes a supported client protocolVersion (2025-06-18)', async () => {
      const body = await callInitialize('2025-06-18')
      expect(body.result.protocolVersion).toBe('2025-06-18')
    })

    it('echoes a supported client protocolVersion (2024-11-05)', async () => {
      const body = await callInitialize('2024-11-05')
      expect(body.result.protocolVersion).toBe('2024-11-05')
    })

    it('falls back to SDK latest when client requests unknown version', async () => {
      const { LATEST_PROTOCOL_VERSION } = await import('@modelcontextprotocol/sdk/types.js')
      const body = await callInitialize('2099-01-01')
      expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    })

    it('falls back to SDK latest when client omits protocolVersion', async () => {
      const { LATEST_PROTOCOL_VERSION } = await import('@modelcontextprotocol/sdk/types.js')
      const body = await callInitialize(undefined)
      expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    })
  })
})
