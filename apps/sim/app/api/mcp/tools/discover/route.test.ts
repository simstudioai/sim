import { createRouteContext } from '@sim/testing/helpers/http'
import { mcpServiceMock, mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/mcp/middleware', () => ({
  mcpBodyReadErrorResponse: vi.fn(() => null),
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: { userId: string; workspaceId: string; requestId: string }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(request, { userId: 'user-1', workspaceId: 'workspace-1', requestId: 'request-1' }),
}))

vi.mock('@/lib/mcp/service', () => mcpServiceMock)

import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
} from '@/lib/mcp/domain-check'
import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { McpConnectionError, McpServerCooldownError } from '@/lib/mcp/types'
import { GET } from '@/app/api/mcp/tools/discover/route'

describe('GET /api/mcp/tools/discover', () => {
  it('asks for reauthorization when the stored grant needs a fresh redirect', async () => {
    mcpServiceMockFns.mockDiscoverServerTools.mockRejectedValueOnce(
      new McpOauthRedirectRequired('https://auth.example.com/authorize?state=secret-state')
    )

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/mcp/tools/discover?workspaceId=workspace-1&serverId=mcp-1'
      ),
      createRouteContext({})
    )

    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain('secret-state')
  })

  const discover = () =>
    GET(
      new NextRequest(
        'http://localhost:3000/api/mcp/tools/discover?workspaceId=workspace-1&serverId=mcp-1'
      ),
      createRouteContext({})
    )

  it.each([
    ['hostname no longer resolves', () => new McpDnsResolutionError('expired.example.com')],
    ['cannot be reached', () => new McpConnectionError('connect ECONNREFUSED', 'Docs')],
    ['is cooling down after a recent failure', () => new McpServerCooldownError('mcp-1')],
    ['times out on tools/list', () => new McpError(ErrorCode.RequestTimeout, 'Request timed out')],
    [
      'answers tools/list with an HTTP error',
      () => new StreamableHTTPError(503, 'Service Unavailable'),
    ],
  ])('answers 422 when the registered server %s', async (_name, makeError) => {
    mcpServiceMockFns.mockDiscoverServerTools.mockRejectedValueOnce(makeError())

    const response = await discover()

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('Failed to discover MCP tools')
  })

  it.each([
    ['resolves to a blocked address', () => new McpSsrfError('blocked address')],
    ['is outside ALLOWED_MCP_DOMAINS', () => new McpDomainNotAllowedError('internal.example.com')],
  ])('answers 403 when the egress policy refuses a server that %s', async (_name, makeError) => {
    mcpServiceMockFns.mockDiscoverServerTools.mockRejectedValueOnce(makeError())

    const response = await discover()

    expect(response.status).toBe(403)
  })

  it('keeps a 500 for a failure that is not the registered server', async () => {
    mcpServiceMockFns.mockDiscoverServerTools.mockRejectedValueOnce(new Error('pool exhausted'))

    const response = await discover()

    expect(response.status).toBe(500)
  })
})
