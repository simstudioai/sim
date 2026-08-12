/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      discover: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  discoverMcpServerToolsUseCase: {
    operation: { id: 'mcp_servers.tools.discover' },
    execute: mocks.discover,
  },
}))

import { WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'
import { McpConnectionError, McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'
import { GET } from '@/app/api/v2/mcp-servers/[id]/tools/route'

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'mcp-3f7a9c21'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const TOOL = {
  name: 'search_docs',
  description: 'Search the internal documentation',
  inputSchema: {
    type: 'object' as const,
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  serverId: SERVER_ID,
  serverName: 'Docs server',
}

function request(query: string) {
  return new NextRequest(`http://localhost:3000/api/v2/mcp-servers/${SERVER_ID}/tools?${query}`, {
    method: 'GET',
    headers: { 'x-api-key': 'key' },
  })
}

const context = { params: Promise.resolve({ id: SERVER_ID }) }

describe('/api/v2/mcp-servers/[id]/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.discover.mockResolvedValue({ tools: [TOOL] })
  })

  it('returns a server tool inventory as a single page', async () => {
    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ data: [TOOL], nextCursor: null })
    expect(mocks.discover).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, serverId: SERVER_ID, refresh: false },
      request: expect.anything(),
    })
  })

  it('forwards an explicit refresh so a caller can bypass the tool cache', async () => {
    await GET(request(`workspaceId=${WORKSPACE_ID}&refresh=true`), { ...context })

    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ refresh: true }) })
    )
  })

  it('rejects a query param it does not implement', async () => {
    const response = await GET(request(`workspaceId=${WORKSPACE_ID}&limit=10`), { ...context })

    expect(response.status).toBe(400)
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('reports an unreachable server as a retryable 503, not a server fault', async () => {
    mocks.discover.mockRejectedValueOnce(new McpConnectionError('ECONNREFUSED', 'Docs server'))

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(response.headers.get('Retry-After')).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
  })

  it('reports a stale OAuth grant as a 409 a client can branch on, never as a Sim credential failure', async () => {
    mocks.discover.mockRejectedValueOnce(
      new McpOauthAuthorizationRequiredError(SERVER_ID, 'Docs server')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toEqual({ code: 'MCP_SERVER_REAUTHORIZATION_REQUIRED' })
  })

  it('does not blame the caller for an upstream protocol fault', async () => {
    mocks.discover.mockRejectedValueOnce(new Error('MCP error -32602: Invalid params'))

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain('Invalid params')
  })

  it('does not report a Sim-side response-schema defect as the caller`s bad request', async () => {
    mocks.discover.mockResolvedValueOnce({
      tools: [{ ...TOOL, inputSchema: { ...TOOL.inputSchema, type: 'string' } }],
    })

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('rejects a workspace API key, which cannot supply the caller`s OAuth grant', async () => {
    mocks.discover.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('authenticates before parsing', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(request(''), { ...context })

    expect(response.status).toBe(401)
    expect(mocks.discover).not.toHaveBeenCalled()
  })
})
