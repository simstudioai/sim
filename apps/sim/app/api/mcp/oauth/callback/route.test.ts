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

const { mockMcpAuth, mockCreateSsrfGuardedMcpFetch, mockGuardedFetch, mockDiscoverServerTools } =
  vi.hoisted(() => ({
    mockMcpAuth: vi.fn(),
    mockCreateSsrfGuardedMcpFetch: vi.fn(),
    mockGuardedFetch: vi.fn(),
    mockDiscoverServerTools: vi.fn(),
  }))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: mockMcpAuth,
}))
vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)
vi.mock('@/lib/mcp/pinned-fetch', () => ({
  createSsrfGuardedMcpFetch: mockCreateSsrfGuardedMcpFetch,
}))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverServerTools: mockDiscoverServerTools },
}))

import { GET } from './route'

describe('MCP OAuth callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCreateSsrfGuardedMcpFetch.mockReturnValue(mockGuardedFetch)
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
    mockMcpAuth.mockResolvedValue('AUTHORIZED')
    mockDiscoverServerTools.mockResolvedValue(undefined)
  })

  it('performs the token exchange through the SSRF-guarded fetch', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/callback?state=state-1&code=auth-code-1'
    )

    await GET(request)

    expect(mockCreateSsrfGuardedMcpFetch).toHaveBeenCalledTimes(1)
    expect(mockMcpAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serverUrl: 'https://mcp.example.com/mcp',
        authorizationCode: 'auth-code-1',
        fetchFn: mockGuardedFetch,
      })
    )
  })
})
