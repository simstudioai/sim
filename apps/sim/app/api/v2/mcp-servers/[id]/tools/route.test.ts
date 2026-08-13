/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
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
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
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

function request(query: string, method = 'GET') {
  return new NextRequest(`http://localhost:3000/api/v2/mcp-servers/${SERVER_ID}/tools?${query}`, {
    method,
    headers: { 'x-api-key': 'key' },
  })
}

const context = { params: Promise.resolve({ id: SERVER_ID }) }

describe('/api/v2/mcp-servers/[id]/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
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

  /**
   * Next aliases a missing `HEAD` export onto `GET`, and RFC 9110 §9.2.1 defines
   * `HEAD` as safe. Discovery is not: it opens a live connection to a
   * third-party endpoint and writes the outcome onto the server row. An uptime
   * monitor or link checker walking the documented URL list would otherwise
   * drive both on every probe, invisibly.
   */
  it('answers HEAD without connecting to the server or writing its status', async () => {
    const response = await GET(request(`workspaceId=${WORKSPACE_ID}&refresh=true`, 'HEAD'), {
      ...context,
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.discover).not.toHaveBeenCalled()
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
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(request(''), { ...context })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.discover).not.toHaveBeenCalled()
  })
})
