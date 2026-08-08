/**
 * @vitest-environment node
 */
import type { mcpServers } from '@sim/db/schema'
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
      list: vi.fn(),
      create: vi.fn(),
      capture: vi.fn(),
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
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  listMcpServersUseCase: { operation: { id: 'mcp_servers.list' }, execute: mocks.list },
  createMcpServerUseCase: { operation: { id: 'mcp_servers.create' }, execute: mocks.create },
}))

import { GET, POST } from '@/app/api/v2/mcp-servers/route'

type McpServerRow = typeof mcpServers.$inferSelect
const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const server = {
  id: 'mcp-server-1',
  workspaceId: WORKSPACE_ID,
  createdBy: 'owner-1',
  name: 'Docs server',
  description: 'Internal docs',
  transport: 'streamable-http',
  url: 'https://mcp.example.com/sse',
  authType: 'headers',
  oauthClientId: null,
  oauthClientSecret: null,
  headers: { Authorization: 'secret' },
  timeout: 30_000,
  retries: 3,
  enabled: true,
  lastConnected: new Date('2026-01-02T00:00:00Z'),
  connectionStatus: 'connected',
  lastError: null,
  statusConfig: {},
  toolCount: 4,
  lastToolsRefresh: new Date('2026-01-02T00:00:00Z'),
  totalRequests: 0,
  lastUsed: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
} as McpServerRow

function request(method: 'GET' | 'POST', url: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/mcp-servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ servers: [server] })
    mocks.create.mockResolvedValue({ server, updated: false })
  })

  it('lists MCP servers without exposing secret header values', async () => {
    const response = await GET(request('GET', `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toMatchObject({ id: server.id, hasHeaders: true })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      request: expect.anything(),
    })
  })

  it('strictly creates an MCP server with the v2 source and status', async () => {
    const response = await POST(
      request('POST', '/api/v2/mcp-servers', {
        workspaceId: WORKSPACE_ID,
        name: server.name,
        url: server.url,
      })
    )

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: server.name,
        url: server.url,
        source: 'api',
      },
      request: expect.anything(),
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps product analytics surface-specific for personal API keys', async () => {
    mocks.authenticate.mockResolvedValueOnce({
      ...AUTH,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-personal' },
      keyType: 'personal',
    })

    const response = await POST(
      request('POST', '/api/v2/mcp-servers', {
        workspaceId: WORKSPACE_ID,
        name: server.name,
        url: server.url,
      })
    )

    expect(response.status).toBe(201)
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'mcp_server_connected',
      expect.objectContaining({ workspace_id: WORKSPACE_ID }),
      expect.anything()
    )
  })

  it('authenticates before parsing create input', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/mcp-servers', {}))

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
