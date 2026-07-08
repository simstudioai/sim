/**
 * @vitest-environment node
 */
import {
  authMockFns,
  dbChainMock,
  dbChainMockFns,
  mcpOauthMock,
  mcpOauthMockFns,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDiscoverServerTools } = vi.hoisted(() => ({
  mockDiscoverServerTools: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverServerTools: mockDiscoverServerTools },
}))

import { GET } from './route'

describe('MCP OAuth callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mcpOauthMockFns.mockLoadOauthRowByState.mockResolvedValue({
      id: 'oauth-row-1',
      mcpServerId: 'server-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'server-1',
        url: 'https://mcp.example.com/mcp',
        workspaceId: 'workspace-1',
      },
    ])
    mcpOauthMockFns.mockLoadPreregisteredClient.mockResolvedValue(undefined)
    mcpOauthMockFns.mockMcpAuthGuarded.mockResolvedValue('AUTHORIZED')
    mockDiscoverServerTools.mockResolvedValue(undefined)
  })

  it('performs the token exchange through the SSRF-guarded mcpAuthGuarded wrapper', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/callback?state=state-1&code=auth-code-1'
    )

    await GET(request)

    // The route must call the guarded wrapper (which defaults fetchFn to the
    // SSRF-guarded fetch internally) rather than the raw SDK `auth()` — see
    // apps/sim/lib/mcp/oauth/auth.test.ts for the wrapper's own fetchFn coverage.
    expect(mcpOauthMockFns.mockMcpAuthGuarded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serverUrl: 'https://mcp.example.com/mcp',
        authorizationCode: 'auth-code-1',
      })
    )
  })
})
