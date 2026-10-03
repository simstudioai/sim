import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { NoWorkspaceAccessError, WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  McpConnectionError,
  McpOauthAuthorizationRequiredError,
  McpServerCooldownError,
} from '@/lib/mcp/types'
import { GET } from '@/app/api/v2/mcp-servers/[mcpServerId]/tools/route'

const { mockDiscoverMcpServerToolsUseCase, mockDiscoverMcpServerToolsUseCaseAuthorize } =
  mcpUseCasesMockFns

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'mcp-3f7a9c21'
const PRINCIPAL = createPersonalApiKeyPrincipal()
const AUTH = {
  principal: PRINCIPAL,
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

const context = createRouteContext({ mcpServerId: SERVER_ID })

describe('/api/v2/mcp-servers/[mcpServerId]/tools', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockDiscoverMcpServerToolsUseCase.mockResolvedValue({ tools: [TOOL] })
    mockDiscoverMcpServerToolsUseCaseAuthorize.mockResolvedValue(undefined)
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
    expect(mockDiscoverMcpServerToolsUseCase).not.toHaveBeenCalled()
    expect(mockDiscoverMcpServerToolsUseCaseAuthorize).toHaveBeenCalledOnce()
  })

  /**
   * A `HEAD` answered before the use case's resource authorization is an
   * existence oracle: any valid API key draws a bodiless 200 for a server id in
   * a workspace it cannot read, for one that does not exist, and for a principal
   * kind this operation refuses outright. These four pin the probe to the answer
   * the `GET` gives.
   */
  it('does not confirm a server to a principal kind the operation refuses', async () => {
    mockDiscoverMcpServerToolsUseCaseAuthorize.mockRejectedValueOnce(
      new WorkspaceApiKeyAuthorizationError()
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`, 'HEAD'), { ...context })

    expect(response.status).toBe(403)
    expect(mockDiscoverMcpServerToolsUseCase).not.toHaveBeenCalled()
  })

  it('does not confirm a server id that does not exist', async () => {
    mockDiscoverMcpServerToolsUseCaseAuthorize.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'MCP server not found')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`, 'HEAD'), { ...context })

    expect(response.status).toBe(404)
    expect(mockDiscoverMcpServerToolsUseCase).not.toHaveBeenCalled()
  })

  it('does not confirm a server in a workspace the caller cannot read', async () => {
    mockDiscoverMcpServerToolsUseCaseAuthorize.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(request('workspaceId=someone-elses-workspace', 'HEAD'), {
      ...context,
    })

    expect(response.status).toBe(404)
    expect(mockDiscoverMcpServerToolsUseCase).not.toHaveBeenCalled()
  })

  it('rejects a HEAD missing the required workspaceId instead of answering 200', async () => {
    const response = await GET(request('', 'HEAD'), { ...context })

    expect(response.status).toBe(400)
    expect(mockDiscoverMcpServerToolsUseCaseAuthorize).not.toHaveBeenCalled()
    expect(mockDiscoverMcpServerToolsUseCase).not.toHaveBeenCalled()
  })

  it('reports an unreachable server as a retryable 503, not a server fault', async () => {
    mockDiscoverMcpServerToolsUseCase.mockRejectedValueOnce(
      new McpConnectionError('ECONNREFUSED', 'Docs server')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(response.headers.get('Retry-After')).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
  })

  it('reports a stale OAuth grant as a 409 a client can branch on, never as a Sim credential failure', async () => {
    mockDiscoverMcpServerToolsUseCase.mockRejectedValueOnce(
      new McpOauthAuthorizationRequiredError(SERVER_ID, 'Docs server')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toEqual({ code: 'MCP_SERVER_REAUTHORIZATION_REQUIRED' })
  })

  it('does not blame the caller for an upstream protocol fault', async () => {
    mockDiscoverMcpServerToolsUseCase.mockRejectedValueOnce(
      new Error('MCP error -32602: Invalid params')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain('Invalid params')
  })

  /**
   * `inputSchema` below the `object` wrapper is authored by the third-party
   * server, and the MCP SDK's own `ToolSchema` does not declare `description`
   * there — its `.catchall(z.unknown())` lets any value through, so a server
   * serializing an absent description as JSON `null` (what a Python `None`
   * produces) reaches Sim unvalidated. Declaring the key more tightly than the
   * upstream schema does made the builder's outbound `.parse()` throw, and
   * discovery answered a bare 500 for a payload the protocol permits.
   */
  it('publishes a tool whose server reported a non-string inputSchema description', async () => {
    mockDiscoverMcpServerToolsUseCase.mockResolvedValueOnce({
      tools: [
        {
          ...TOOL,
          inputSchema: { type: 'object' as const, description: null, properties: {} },
        },
      ],
    })

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0].inputSchema).toEqual({
      type: 'object',
      description: null,
      properties: {},
    })
  })

  /**
   * `McpConnectionError` interpolates the server's display name into its
   * message, so selecting the 503 wording by searching that message for
   * `cooldown` hands a server named after the word the negative-cache wording
   * for a cooldown it was never in.
   */
  it('does not read cooldown wording out of a server display name', async () => {
    mockDiscoverMcpServerToolsUseCase.mockRejectedValueOnce(
      new McpConnectionError('ECONNREFUSED', 'Cooldown Docs')
    )

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.message).toBe('The MCP server could not be reached')
  })

  it('reports a server inside the discovery cooldown with its own wording', async () => {
    mockDiscoverMcpServerToolsUseCase.mockRejectedValueOnce(new McpServerCooldownError(SERVER_ID))

    const response = await GET(request(`workspaceId=${WORKSPACE_ID}`), { ...context })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.message).toBe('The MCP server recently failed and is in cooldown')
  })
})
