import type { mcpServers } from '@sim/db/schema'
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { GET, PATCH } from '@/app/api/v2/mcp-servers/[mcpServerId]/route'

const { mockGetMcpServerUseCase, mockUpdateMcpServerUseCase, mockDeleteMcpServerUseCase } =
  mcpUseCasesMockFns

type McpServerRow = typeof mcpServers.$inferSelect
const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID })
const AUTH = {
  principal: PRINCIPAL,
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
const context = createRouteContext({ mcpServerId: server.id })

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/v2/mcp-servers/${server.id}${query}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/mcp-servers/[mcpServerId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockGetMcpServerUseCase.mockResolvedValue({ server })
    mockUpdateMcpServerUseCase.mockResolvedValue({ server })
    mockDeleteMcpServerUseCase.mockResolvedValue({ server })
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mockGetMcpServerUseCase.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mockUpdateMcpServerUseCase.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, name: 'New docs' }), context))
        .status
    ).toBe(403)
  })
})
