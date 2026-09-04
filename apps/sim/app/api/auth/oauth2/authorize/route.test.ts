/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialConnectionProviderMismatchError } from '@/lib/credentials/application/connection-target'

const mocks = vi.hoisted(() => ({
  betterAuthGET: vi.fn(),
  getSession: vi.fn(),
  linkAccount: vi.fn(),
  getBaseUrl: vi.fn(),
  requireClient: vi.fn(),
  createConnection: vi.fn(),
  getPerRequestScopes: vi.fn(),
  launchConnection: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ GET: mocks.betterAuthGET }),
}))

vi.mock('@/lib/auth/auth', () => ({
  getSession: mocks.getSession,
  auth: { handler: {}, api: { oAuth2LinkAccount: mocks.linkAccount } },
}))
vi.mock('@/lib/core/utils/urls', () => ({
  SITE_URL: 'https://www.sim.ai',
  getBaseUrl: mocks.getBaseUrl,
}))
vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  requireConfiguredOAuthClient: mocks.requireClient,
  wireServerFallback: () => ({
    configured: false,
    providerIds: [],
    providers: [],
    execute: vi.fn(),
  }),
}))
vi.mock('@/lib/credentials/application/create-credential-connection', () => ({
  createCredentialConnection: {
    operation: { id: 'credentials.connections.create' },
    execute: mocks.createConnection,
  },
}))
vi.mock('@/lib/credentials/application/launch-credential-connection', () => ({
  launchCredentialConnection: {
    operation: { id: 'credentials.connections.launch' },
    execute: mocks.launchConnection,
  },
}))
vi.mock('@/lib/oauth/utils', () => ({
  getPerRequestOAuthLinkScopes: mocks.getPerRequestScopes,
}))

import { GET } from '@/app/api/auth/oauth2/authorize/route'

const BASE_URL = 'https://sim.test'
const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

afterAll(resetEnvFlagsMock)

function request(query: Record<string, string>) {
  const url = new URL('/api/auth/oauth2/authorize', BASE_URL)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return createMockRequest('GET', undefined, {}, url.toString())
}

function linkResponse(url = 'https://provider.example/authorize') {
  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OAuth2 authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isOAuthProviderEnabled: true })
    mocks.getBaseUrl.mockReturnValue(BASE_URL)
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.createConnection.mockResolvedValue({
      providerId: 'google-email',
      workspaceId: WORKSPACE_ID,
      draftId: 'draft-1',
      expiresAt: new Date('2026-08-14T12:00:00.000Z'),
      authorizationUrl: `${BASE_URL}/api/auth/oauth2/authorize?draftId=draft-1`,
    })
    mocks.launchConnection.mockResolvedValue({
      draft: {
        id: 'draft-1',
        providerId: 'google-email',
        workspaceId: WORKSPACE_ID,
        credentialId: null,
      },
    })
    mocks.linkAccount.mockResolvedValue(linkResponse())
    mocks.getPerRequestScopes.mockReturnValue(undefined)
    mocks.betterAuthGET.mockResolvedValue(new Response(null, { status: 302 }))
  })

  it('forwards a provider request without entering the connector flow', async () => {
    const providerRequest = request({
      client_id: 'client-1',
      providerId: 'google-email',
      draftId: 'draft-1',
    })

    const response = await GET(providerRequest)

    expect(response.status).toBe(302)
    expect(mocks.betterAuthGET).toHaveBeenCalledWith(providerRequest)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.launchConnection).not.toHaveBeenCalled()
    expect(mocks.createConnection).not.toHaveBeenCalled()
  })

  it('returns 404 without delegation when the provider is disabled', async () => {
    setEnvFlags({ isOAuthProviderEnabled: false })

    const response = await GET(request({ client_id: 'client-1' }))

    expect(response.status).toBe(404)
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it.each([
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'request_uri',
    'code_challenge',
    'code_challenge_method',
    'nonce',
    'prompt',
  ])('rejects a repeated OAuth provider %s before Better Auth', async (parameter) => {
    const url = new URL('/api/auth/oauth2/authorize', BASE_URL)
    url.searchParams.set('client_id', 'sim-cli')
    url.searchParams.append(parameter, 'first')
    url.searchParams.append(parameter, 'second')

    const response = await GET(createMockRequest('GET', undefined, {}, url.toString()))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it('creates a canonical application draft for a legacy connect URL', async () => {
    const response = await GET(request({ providerId: 'google-email', workspaceId: WORKSPACE_ID }))

    expect(response.headers.get('location')).toBe('https://provider.example/authorize')
    expect(mocks.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: WORKSPACE_ID, providerId: 'google-email' },
      })
    )
    expect(mocks.linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          providerId: 'google-email',
          callbackURL: expect.stringContaining('credentialDraftId=draft-1'),
        }),
      })
    )
  })

  it('requires a configured OAuth client before creating a legacy draft', async () => {
    mocks.requireClient.mockImplementationOnce(() => {
      throw new Error('OAuth client is not configured')
    })

    const response = await GET(request({ providerId: 'google-email', workspaceId: WORKSPACE_ID }))

    expect(response.headers.get('location')).toBe(`${BASE_URL}/workspace?error=oauth_link_failed`)
    expect(mocks.requireClient).toHaveBeenCalledWith('google-email')
    expect(mocks.createConnection).not.toHaveBeenCalled()
  })

  it('passes per-request scopes to providers that cannot inherit static connector scopes', async () => {
    const scopes = ['openid', 'https://dynamics.microsoft.com/user_impersonation']
    mocks.getPerRequestScopes.mockReturnValue(scopes)
    mocks.createConnection.mockResolvedValue({
      providerId: 'microsoft-dataverse',
      workspaceId: WORKSPACE_ID,
      draftId: 'draft-1',
      expiresAt: new Date(),
      authorizationUrl: '',
    })

    await GET(request({ providerId: 'microsoft-dataverse', workspaceId: WORKSPACE_ID }))

    expect(mocks.linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          providerId: 'microsoft-dataverse',
          scopes,
        }),
      })
    )
  })

  it('launches an exact draft without creating another one', async () => {
    const response = await GET(request({ draftId: 'draft-1' }))

    expect(response.headers.get('location')).toBe('https://provider.example/authorize')
    expect(mocks.launchConnection).toHaveBeenCalledWith(
      expect.objectContaining({ input: { draftId: 'draft-1' } })
    )
    expect(mocks.createConnection).not.toHaveBeenCalled()
  })

  it('passes reconnect provider assertions through the application use case', async () => {
    mocks.createConnection.mockResolvedValue({
      providerId: 'google-email',
      workspaceId: WORKSPACE_ID,
      credentialId: 'credential-1',
      draftId: 'draft-1',
      expiresAt: new Date(),
      authorizationUrl: '',
    })

    await GET(
      request({
        providerId: 'google-email',
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
      })
    )

    expect(mocks.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: WORKSPACE_ID,
          credentialId: 'credential-1',
          assertedProviderId: 'google-email',
        },
      })
    )
  })

  it('maps a provider mismatch without exposing the credential', async () => {
    mocks.createConnection.mockRejectedValue(
      new CredentialConnectionProviderMismatchError('google-email', 'slack')
    )

    const response = await GET(
      request({
        providerId: 'slack',
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
      })
    )

    expect(response.headers.get('location')).toBe(
      `${BASE_URL}/workspace?error=credential_provider_mismatch`
    )
  })

  it('maps credential and workspace authorization failures separately', async () => {
    mocks.createConnection.mockRejectedValueOnce(
      new ForbiddenOperationError(
        'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
        'Credential admin permission required'
      )
    )
    const credentialResponse = await GET(
      request({
        providerId: 'google-email',
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
      })
    )
    mocks.createConnection.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Write permission required')
    )
    const workspaceResponse = await GET(
      request({ providerId: 'google-email', workspaceId: WORKSPACE_ID })
    )

    expect(credentialResponse.headers.get('location')).toContain('credential_access_denied')
    expect(workspaceResponse.headers.get('location')).toContain('workspace_access_denied')
  })

  it('keeps a reconnect workspace-role denial classified as workspace access', async () => {
    mocks.createConnection.mockRejectedValue(new InsufficientWorkspacePermissionsError())

    const response = await GET(
      request({
        providerId: 'google-email',
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
      })
    )

    expect(response.headers.get('location')).toBe(
      `${BASE_URL}/workspace?error=workspace_access_denied`
    )
  })

  it('redirects a draft launch infrastructure failure through the browser error contract', async () => {
    mocks.launchConnection.mockRejectedValue(new Error('Database unavailable'))

    const response = await GET(request({ draftId: 'draft-1' }))

    expect(response.headers.get('location')).toBe(`${BASE_URL}/workspace?error=oauth_link_failed`)
  })

  it('routes custom providers through the exact application draft', async () => {
    mocks.createConnection.mockResolvedValue({
      providerId: 'trello',
      workspaceId: WORKSPACE_ID,
      draftId: 'draft-1',
      expiresAt: new Date(),
      authorizationUrl: '',
    })

    const response = await GET(request({ providerId: 'trello', workspaceId: WORKSPACE_ID }))
    const location = new URL(response.headers.get('location') ?? '')

    expect(location.pathname).toBe('/api/auth/trello/authorize')
    expect(location.searchParams.get('draftId')).toBe('draft-1')
  })
})
