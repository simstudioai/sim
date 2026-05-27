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
const MCP_BYTE_LIMIT = 10 * 1024 * 1024
const MCP_TOOLS_LIST_LIMIT = 100

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
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

import { DELETE, GET, POST } from '@/app/api/mcp/serve/[serverId]/route'

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

  it('allows unauthenticated GET metadata for public servers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1')
    const response = await GET(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.name).toBe('Public Server')
    expect(hybridAuthMockFns.mockCheckHybridAuth).not.toHaveBeenCalled()
  })

  it('authenticates private SSE-style GET before returning unsupported transport', async () => {
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
      headers: { accept: 'text/event-stream' },
    })

    const response = await GET(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 405 for authorized SSE-style GET', async () => {
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
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      headers: { accept: 'text/event-stream' },
    })

    const response = await GET(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST, DELETE')
    expect(body.error.code).toBe('unsupported_transport')
  })

  it('requires authentication for DELETE even on public servers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'DELETE',
    })
    const response = await DELETE(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(401)
  })

  it('uses an internal bridge token for private server api_key auth', async () => {
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
    mockGenerateInternalToken.mockResolvedValueOnce('internal-token-user-1')
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
    expect(headers.Authorization).toBe('Bearer internal-token-user-1')
    expect(headers['X-Sim-MCP-Tool-Actor']).toBe('authenticated-user')
    expect(headers['X-API-Key']).toBeUndefined()
    expect(mockGenerateInternalToken).toHaveBeenCalledWith('user-1')
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
    expect(headers['X-Sim-MCP-Tool-Actor']).toBeUndefined()
    expect(headers['X-API-Key']).toBeUndefined()
    expect(mockGenerateInternalToken).toHaveBeenCalledWith('user-1')
  })

  it('rejects oversized MCP request bodies before parsing JSON', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { 'content-length': String(MCP_BYTE_LIMIT + 1) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body exceeds maximum size')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects streamed MCP request bodies that exceed the cap without content-length', async () => {
    const cancelSpy = vi.fn()
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_BYTE_LIMIT))
        controller.enqueue(new Uint8Array(1))
      },
      cancel: cancelSpy,
    })
    const request = new Request('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const req = new NextRequest(request)

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body')
    expect(cancelSpy).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized tools/call arguments before internal fetch', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { payload: 'x'.repeat(MCP_BYTE_LIMIT) } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels and rejects oversized workflow execution responses', async () => {
    const cancelSpy = vi.fn()
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: cancelSpy,
        }),
        {
          status: 200,
          headers: { 'content-length': String(MCP_BYTE_LIMIT + 1) },
        }
      )
    )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP workflow execution response')
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('cancels and rejects streamed workflow responses that exceed the cap', async () => {
    const cancelSpy = vi.fn()
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MCP_BYTE_LIMIT))
            controller.enqueue(new Uint8Array(1))
          },
          cancel: cancelSpy,
        }),
        {
          status: 200,
          headers: { 'content-length': '1' },
        }
      )
    )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP workflow execution response')
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('preserves recoverable workflow execution statuses through the MCP bridge', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Workflow execution request body exceeds maximum size',
        }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.code).toBe(-32600)
    expect(body.error.data.httpStatus).toBe(413)
    const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit
    const headers = fetchOptions.headers as Record<string, string>
    expect(headers['X-Sim-MCP-Tool-Call']).toBe('true')
  })

  it('preserves upstream error status when workflow response is not JSON', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 408 }))

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(408)
    expect(body.error.data.httpStatus).toBe(408)
    expect(body.error.data.retryable).toBe(true)
  })

  it('preserves falsy workflow outputs in MCP tool results', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, output: false }), {
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
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.content[0].text).toBe('false')
  })

  it('serializes missing workflow output without failing the MCP tool call', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
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
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.content[0].text).toContain('"success": true')
  })

  it('serializes non-object workflow JSON responses from response blocks', async () => {
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
      new Response(JSON.stringify(['a', 'b']), {
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
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.content[0].text).toBe(JSON.stringify(['a', 'b'], null, 2))
  })

  it('rejects duplicate tool names instead of choosing an arbitrary workflow', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([
        { toolName: 'tool_a', workflowId: 'wf-1' },
        { toolName: 'tool_a', workflowId: 'wf-2' },
      ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.data.code).toBe('duplicate_tool_name')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts the internal workflow fetch when the MCP client disconnects', async () => {
    const requestAbortController = new AbortController()
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ isDeployed: true }])
    fetchMock.mockImplementationOnce((_url, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          },
          { once: true }
        )
        requestAbortController.abort()
      })
    })

    const req = new NextRequest(
      new Request('http://localhost:3000/api/mcp/serve/server-1', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'tool_a', arguments: { q: 'test' } },
        }),
        signal: requestAbortController.signal,
      })
    )

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })

    expect(response.status).toBe(499)
  })

  it('paginates tools/list by tool count', async () => {
    const pageRows = Array.from({ length: MCP_TOOLS_LIST_LIMIT + 1 }, (_, index) => ({
      id: `tool-id-${String(index).padStart(3, '0')}`,
      toolNameBytes: 10 + index,
      toolDescriptionBytes: 0,
      parameterSchemaBytes: 32,
    }))
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pageRows)
      .mockResolvedValueOnce(
        pageRows.map((row, index) => ({
          id: row.id,
          toolName: `tool_${index}`,
          toolDescription: null,
          parameterSchema: { type: 'object', properties: {} },
        }))
      )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.tools).toHaveLength(MCP_TOOLS_LIST_LIMIT)
    expect(body.result.nextCursor).toBe('tool-id-099')
  })

  it('bounds tools/list by stored metadata estimate', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'tool-id-1',
          toolNameBytes: 6,
          toolDescriptionBytes: MCP_BYTE_LIMIT + 1,
          parameterSchemaBytes: 32,
        },
      ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('tools/list response is too large')
  })

  it('bounds tools/list by final serialized response size', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'tool-id-1',
          toolNameBytes: 6,
          toolDescriptionBytes: 1,
          parameterSchemaBytes: 32,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'tool-id-1',
          toolName: 'tool_a',
          toolDescription: 'x'.repeat(MCP_BYTE_LIMIT),
          parameterSchema: { type: 'object', properties: {} },
        },
      ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    const response = await POST(req, { params: Promise.resolve({ serverId: 'server-1' }) })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('tools/list response is too large')
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
