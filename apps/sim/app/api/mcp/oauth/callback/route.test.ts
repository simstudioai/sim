import {
  authMockFns,
  dbChainMockFns,
  mcpOauthMock,
  mcpOauthMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { mcpServiceMock, mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialGroupOAuthStateVersionError } from '@/lib/credential-groups/oauth-attempt-version'

const {
  mockAuthenticateEnrollment,
  mockCompleteManagedMcpOAuth,
  mockConsumeManagedAttempt,
  mockEnforceCallbackRateLimit,
} = vi.hoisted(() => ({
  mockAuthenticateEnrollment: vi.fn(),
  mockCompleteManagedMcpOAuth: vi.fn(),
  mockConsumeManagedAttempt: vi.fn(),
  mockEnforceCallbackRateLimit: vi.fn(),
}))

vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)
vi.mock('@/lib/mcp/service', () => mcpServiceMock)
vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  credentialGroupOAuthAttemptPrincipal: mockAuthenticateEnrollment,
}))
vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupMcpOAuth: { execute: mockCompleteManagedMcpOAuth },
}))
vi.mock('@/lib/credential-groups/mcp-oauth-state', () => ({
  consumeCredentialGroupMcpOAuthAttempt: mockConsumeManagedAttempt,
  isCredentialGroupMcpOAuthState: (state: string) => state.startsWith('mcp_cg_'),
}))
vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mockEnforceCallbackRateLimit,
}))

import { GET } from '@/app/api/mcp/oauth/callback/route'

const { mockDiscoverServerTools } = mcpServiceMockFns

describe('MCP OAuth callback route', () => {
  beforeEach(() => {
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
    mockConsumeManagedAttempt.mockResolvedValue({
      state: 'mcp_cg_state-1',
      workspaceId: 'workspace-1',
      email: 'invitee@example.com',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      mcpServerId: 'server-1',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
      createdAt: Date.now(),
    })
    mockAuthenticateEnrollment.mockReturnValue({
      kind: 'credential_group_enrollment',
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      enrollmentId: 'enrollment-1',
      email: 'invitee@example.com',
      invitationTokenHash: 'token-hash',
    })
    mockCompleteManagedMcpOAuth.mockResolvedValue({
      connectionId: 'mcp-cg-connection-1',
      mcpServerId: 'server-1',
    })
    mockEnforceCallbackRateLimit.mockResolvedValue(null)
  })

  it.each([undefined, 'denied'])(
    'finishes a direct connection without the invitation form: %s',
    async (error) => {
      const completionId = '00000000-0000-4000-8000-000000000002'
      mockConsumeManagedAttempt.mockResolvedValueOnce({
        state: 'mcp_cg_direct',
        organizationId: 'organization-1',
        invitationToken: 'invitation-token',
        mcpServerId: 'server-1',
        completionId,
        returnTo: 'integrations',
      })
      const response = await GET(
        new NextRequest(
          `http://localhost:3000/api/mcp/oauth/callback?state=mcp_cg_direct&${error ? 'error=denied' : 'code=code-1'}`
        )
      )
      const destination = new URL(response.headers.get('location')!, 'http://localhost:3000')
      expect(destination.pathname).toBe('/credential-groups/complete')
      expect(destination.searchParams.get('completionId')).toBe(completionId)
      expect(destination.searchParams.get('organizationId')).toBe('organization-1')
      expect(destination.searchParams.get('oauth')).toBe(error ?? null)
    }
  )

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

  it('signals success over a same-origin BroadcastChannel carrying the state nonce', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/callback?state=state-1&code=auth-code-1'
    )

    const body = await (await GET(request)).text()

    // The completion is delivered over a BroadcastChannel (not window.opener.postMessage)
    // so a COOP `same-origin` provider that severs the opener can't strand the parent. The
    // `state` nonce lets the hook react only in the tab that started this exact flow.
    expect(body).toContain("new BroadcastChannel('mcp-oauth')")
    expect(body).toContain('ok: true')
    expect(body).toContain('"server-1"')
    expect(body).toContain('"state-1"')
  })

  it('echoes the state on a serverless invalid_state failure so the initiating tab can react', async () => {
    // No row loads for the state -> failure with no serverId. The state must still be echoed,
    // or the initiating tab would sit on "Connecting…" until its safety timeout.
    mcpOauthMockFns.mockLoadOauthRowByState.mockResolvedValueOnce(null)
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/callback?state=state-1&code=auth-code-1'
    )

    const body = await (await GET(request)).text()

    expect(body).toContain('ok: false')
    expect(body).toContain('"state-1"')
    expect(body).toContain('serverId: undefined')
  })

  it('rate limits a managed callback before consuming its one-time state', async () => {
    const limitedResponse = new Response('rate limited', { status: 429 })
    mockEnforceCallbackRateLimit.mockResolvedValueOnce(limitedResponse)
    const request = new NextRequest(
      'http://localhost:3000/api/mcp/oauth/callback?state=mcp_cg_state-1&code=auth-code-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(429)
    expect(mockConsumeManagedAttempt).not.toHaveBeenCalled()
    expect(mockCompleteManagedMcpOAuth).not.toHaveBeenCalled()
  })
  it('reports a state protocol change without exchanging a code or loading an enrollment', async () => {
    mockConsumeManagedAttempt.mockRejectedValue(new CredentialGroupOAuthStateVersionError())
    const response = await GET(
      new NextRequest('http://localhost:3000/api/mcp/oauth/callback?state=mcp_cg_old&code=code')
    )
    expect(await response.text()).toContain('Reopen your invitation and connect again')
    expect(mockAuthenticateEnrollment).not.toHaveBeenCalled()
    expect(mockCompleteManagedMcpOAuth).not.toHaveBeenCalled()
  })
})
