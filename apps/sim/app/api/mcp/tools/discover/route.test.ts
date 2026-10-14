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

import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { GET } from '@/app/api/mcp/tools/discover/route'

describe('GET /api/mcp/tools/discover', () => {
  it('asks for reauthorization when the stored grant needs a fresh redirect', async () => {
    mcpServiceMockFns.mockDiscoverServerTools.mockRejectedValueOnce(
      new McpOauthRedirectRequired('https://auth.example.com/authorize?state=secret-state')
    )

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/mcp/tools/discover?workspaceId=workspace-1&serverId=mcp-1'
      )
    )

    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain('secret-state')
  })
})
