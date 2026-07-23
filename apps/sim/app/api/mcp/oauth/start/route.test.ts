/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hybridAuthMockFns,
  McpOauthRedirectRequiredMock,
  mcpOauthMock,
  mcpOauthMockFns,
  OauthStepTimeoutErrorMock,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)

import { GET, surfaceOauthError } from './route'

describe('MCP OAuth start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-2',
      userName: 'User Two',
      userEmail: 'user2@example.com',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'server-1',
        name: 'Exa',
        url: 'https://mcp.exa.ai/mcp',
        workspaceId: 'workspace-1',
        authType: 'oauth',
        deletedAt: null,
      },
    ])
    mcpOauthMockFns.mockGetOrCreateOauthRow.mockResolvedValue({
      id: 'oauth-row-1',
      mcpServerId: 'server-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      clientInformation: null,
      tokens: null,
      codeVerifier: null,
      state: null,
      stateCreatedAt: null,
      updatedAt: new Date(),
    })
    mcpOauthMockFns.mockLoadPreregisteredClient.mockResolvedValue(undefined)
    mcpOauthMockFns.mockMcpAuthGuarded.mockRejectedValue(
      new McpOauthRedirectRequiredMock('https://mcp.exa.ai/authorize')
    )
  })

  it('routes OAuth discovery through the SSRF-guarded mcpAuthGuarded wrapper', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    await GET(request)

    // The route must call the guarded wrapper (which defaults fetchFn to the
    // SSRF-guarded fetch internally) rather than the raw SDK `auth()` — see
    // apps/sim/lib/mcp/oauth/auth.test.ts for the wrapper's own fetchFn coverage.
    expect(mcpOauthMockFns.mockMcpAuthGuarded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serverUrl: 'https://mcp.exa.ai/mcp' })
    )
  })

  it('returns 504 (not a retry) when the auth step times out', async () => {
    // The stall is intentionally NOT auto-retried — a lingering attempt shares the OAuth row and
    // could corrupt the retry's PKCE/state. The bounded step fails fast; the user re-clicks.
    mcpOauthMockFns.mockMcpAuthGuarded.mockImplementationOnce(() => {
      throw new OauthStepTimeoutErrorMock('mcpAuthGuarded', 12_000)
    })
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)

    expect(mcpOauthMockFns.mockMcpAuthGuarded).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(504)
  })

  it('returns 504 (not a generic 500) when a DB step times out', async () => {
    // DB-step timeouts are bounded too; their OauthStepTimeoutError must reach the same
    // 504 handler, not fall through to the generic 500.
    mcpOauthMockFns.mockGetOrCreateOauthRow.mockImplementationOnce(() => {
      throw new OauthStepTimeoutErrorMock('getOrCreateOauthRow', 5_000)
    })
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(504)
    expect(mcpOauthMockFns.mockMcpAuthGuarded).not.toHaveBeenCalled()
  })

  it('returns the authorize URL without error-logging the success redirect throw', async () => {
    mcpOauthMockFns.mockMcpAuthGuarded.mockRejectedValueOnce(
      new McpOauthRedirectRequiredMock('https://mcp.exa.ai/authorize')
    )
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(mcpOauthMockFns.mockMcpAuthGuarded).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'redirect', authorizationUrl: 'https://mcp.exa.ai/authorize' })
  })

  it('requires workspace write permission via MCP auth middleware', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    await GET(request)

    expect(permissionsMockFns.mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'user-2',
      'workspace',
      'workspace-1'
    )
  })

  it('uses a workspace-scoped OAuth row and stamps the latest authorizing user', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      status: 'redirect',
      authorizationUrl: 'https://mcp.exa.ai/authorize',
    })
    expect(mcpOauthMockFns.mockGetOrCreateOauthRow).toHaveBeenCalledWith({
      mcpServerId: 'server-1',
      userId: 'user-2',
      workspaceId: 'workspace-1',
    })
    expect(mcpOauthMockFns.mockSetOauthRowUser).toHaveBeenCalledWith('oauth-row-1', 'user-2')
  })

  it('rejects a second user starting OAuth while another authorization is active', async () => {
    mcpOauthMockFns.mockGetOrCreateOauthRow.mockResolvedValueOnce({
      id: 'oauth-row-1',
      mcpServerId: 'server-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      clientInformation: null,
      tokens: null,
      codeVerifier: null,
      state: 'hashed-active-state',
      stateCreatedAt: new Date(),
      updatedAt: new Date(),
    })
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('OAuth authorization already in progress for this server')
    expect(mcpOauthMockFns.mockMcpAuthGuarded).not.toHaveBeenCalled()
  })

  it('does not leak non-OAuth internal error details to the client', async () => {
    mcpOauthMockFns.mockGetOrCreateOauthRow.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 (internal-db-host)')
    )
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Failed to start OAuth flow')
    expect(body.error).not.toContain('ECONNREFUSED')
    expect(body.error).not.toContain('internal-db-host')
  })

  it('returns an actionable 4xx when the server does not support dynamic client registration', async () => {
    mcpOauthMockFns.mockMcpAuthGuarded.mockRejectedValueOnce(
      new Error('Incompatible auth server: does not support dynamic client registration')
    )
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/start?workspaceId=workspace-1&serverId=server-1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toBe(
      "This server doesn't support automatic OAuth client registration. Add a pre-registered OAuth client ID and secret, or configure a token instead."
    )
  })
})

describe('surfaceOauthError', () => {
  it('uses typed OAuthError errorCode and message for spec-compliant errors', async () => {
    const { InvalidGrantError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js')
    const err = new InvalidGrantError('Refresh token expired')
    expect(surfaceOauthError(err)).toBe('invalid_grant: Refresh token expired')
  })

  it('parses Raw body envelope for ServerError fallbacks (non-spec vendors)', async () => {
    const { ServerError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js')
    const err = new ServerError(
      'HTTP 400: Invalid OAuth error response: zod error. Raw body: {"code":400,"message":"redirect URI https://example.com/cb is not allowed","retryable":false}'
    )
    expect(surfaceOauthError(err)).toBe(
      'Authorization server: redirect URI https://example.com/cb is not allowed'
    )
  })

  it('prefers error_description over message over error in fallback envelope', async () => {
    const { ServerError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js')
    const err = new ServerError(
      'HTTP 400: Invalid OAuth error response: zod. Raw body: {"error":"invalid_grant","error_description":"the description","message":"the message"}'
    )
    expect(surfaceOauthError(err)).toBe('Authorization server: the description')
  })

  it('returns first line of generic errors', () => {
    const err = new Error('Network blip\n  at fetch (...)')
    expect(surfaceOauthError(err)).toBe('Network blip')
  })

  it('truncates messages longer than 250 chars with ellipsis', async () => {
    const { InvalidGrantError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js')
    const longMessage = 'x'.repeat(300)
    const result = surfaceOauthError(new InvalidGrantError(longMessage))
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBe(251)
  })

  it('returns generic fallback for non-Error values', () => {
    expect(surfaceOauthError(null)).toBe('Failed to start OAuth flow')
    expect(surfaceOauthError(undefined)).toBe('Failed to start OAuth flow')
  })
})
