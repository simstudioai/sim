/**
 * @vitest-environment node
 */
import type { mcpServers } from '@sim/db/schema'
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
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  capture: vi.fn(),
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
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  getMcpServerUseCase: { operation: { id: 'mcp_servers.read' }, execute: mocks.get },
  updateMcpServerUseCase: { operation: { id: 'mcp_servers.update' }, execute: mocks.update },
  deleteMcpServerUseCase: { operation: { id: 'mcp_servers.delete' }, execute: mocks.remove },
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/mcp-servers/[id]/route'

type McpServerRow = typeof mcpServers.$inferSelect
const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const server = {
  id: 'mcp-server-1',
  workspaceId: WORKSPACE_ID,
  createdBy: 'owner-1',
  name: 'Docs server',
  description: null,
  transport: 'streamable-http',
  url: 'https://mcp.example.com/sse',
  authType: 'headers',
  oauthClientId: null,
  oauthClientSecret: null,
  headers: {},
  timeout: 30_000,
  retries: 3,
  enabled: true,
  lastConnected: null,
  connectionStatus: 'connected',
  lastError: null,
  statusConfig: {},
  toolCount: 0,
  lastToolsRefresh: null,
  totalRequests: 0,
  lastUsed: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
} as McpServerRow
const context = { params: Promise.resolve({ id: server.id }) }

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return new NextRequest(`http://localhost:3000/api/v2/mcp-servers/${server.id}${query}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/mcp-servers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.get.mockResolvedValue({ server })
    mocks.update.mockResolvedValue({ server })
    mocks.remove.mockResolvedValue({ server })
  })

  it('gets an MCP server through the semantic read operation', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, serverId: server.id },
      request: expect.anything(),
    })
  })

  /**
   * Every list in this family rejects a query param it does not implement, so
   * the single-resource reads must too. A caller who mistypes a flag otherwise
   * gets a 200 that silently ignored it, which reads as confirmation the flag
   * exists and does nothing.
   */
  it('rejects a query param it does not implement', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/mcp-servers/${server.id}?workspaceId=${WORKSPACE_ID}&includeTools=true`,
        { method: 'GET', headers: { 'x-api-key': 'key' } }
      ),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('updates an MCP server through the strict semantic update operation', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, name: 'New docs' }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        serverId: server.id,
        name: 'New docs',
        source: 'api',
      },
      request: expect.anything(),
    })
  })

  it('deletes an MCP server without product analytics for workspace keys', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: server.id, deleted: true } })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, serverId: server.id, source: 'api' },
      request: expect.anything(),
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('authenticates before parsing an invalid update body', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await PATCH(request('PATCH', {}), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mocks.get.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mocks.update.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, name: 'New docs' }), context))
        .status
    ).toBe(403)
  })
})
