import type { mcpServers } from '@sim/db/schema'
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/mcp-servers/route'

const mocks = {
  list: mcpUseCasesMockFns.mockListMcpServersUseCase,
  create: mcpUseCasesMockFns.mockCreateMcpServerUseCase,
}

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
  return createMockRequest({
    method,
    url: `http://localhost:3000${url}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/mcp-servers', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({
      servers: [server],
      nextCursorKeys: null,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
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
        limit: 50,
        cursor: undefined,
        cursorKeys: undefined,
      },
      request: expect.anything(),
    })
  })

  it('mints a resumable cursor and replays it against the same sort', async () => {
    mocks.list.mockResolvedValueOnce({
      servers: [server],
      nextCursorKeys: [server.createdAt.toISOString(), server.id],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const first = await GET(
      request('GET', `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&limit=1`)
    )
    const { nextCursor } = await first.json()

    expect(nextCursor).toEqual(expect.any(String))

    const second = await GET(
      request(
        'GET',
        `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&limit=1&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(second.status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          cursorKeys: [server.createdAt.toISOString(), server.id],
        }),
      })
    )
  })

  it('rejects a cursor minted under a different sort', async () => {
    mocks.list.mockResolvedValueOnce({
      servers: [server],
      nextCursorKeys: [server.createdAt.toISOString(), server.id],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const first = await GET(
      request('GET', `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&limit=1`)
    )
    const { nextCursor } = await first.json()

    const response = await GET(
      request(
        'GET',
        `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&limit=1&sortBy=name&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(response.status).toBe(400)
  })

  /**
   * The sort case above is a separate stamp. This pins the filter half of the
   * binding end-to-end — the mint in `present` and the read in `mapInput` —
   * because the contract-level sweep only checks a hand-maintained map of param
   * names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({
      servers: [server],
      nextCursorKeys: [server.createdAt.toISOString(), server.id],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const minted = await GET(
      request('GET', `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&search=docs`)
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      request(
        'GET',
        `/api/v2/mcp-servers?workspaceId=${WORKSPACE_ID}&search=tickets&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
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
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
