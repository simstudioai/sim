/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
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
  decryptQuickBooksClientConfig: vi.fn(),
  createQuickBooksState: vi.fn(),
  getCanonicalScopes: vi.fn(),
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
vi.mock('@/lib/credentials/application/launch-scoped-credential-connection', () => ({
  launchScopedCredentialConnection: mocks.launchConnection,
}))
vi.mock('@/lib/oauth/utils', () => ({
  getPerRequestOAuthLinkScopes: mocks.getPerRequestScopes,
  getCanonicalScopesForProvider: mocks.getCanonicalScopes,
}))
vi.mock('@/lib/oauth/quickbooks-client-config', () => ({
  decryptQuickBooksOAuthClientConfig: mocks.decryptQuickBooksClientConfig,
}))
vi.mock('@/lib/oauth/quickbooks-state', () => ({
  createQuickBooksOAuthState: mocks.createQuickBooksState,
}))

import { GET } from '@/app/api/auth/oauth2/authorize/route'

const BASE_URL = 'https://sim.test'
const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

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

afterAll(resetEnvFlagsMock)

describe('OAuth2 authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isAuthDisabled: false })
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
    mocks.getCanonicalScopes.mockReturnValue([
      'openid',
      'profile',
      'email',
      'com.intuit.quickbooks.accounting',
    ])
    mocks.decryptQuickBooksClientConfig.mockResolvedValue({
      clientId: 'intuit-client-id',
      clientSecret: 'intuit-client-secret',
      environment: 'sandbox',
      webhookVerifierToken: 'verifier-token',
    })
    mocks.createQuickBooksState.mockReturnValue('signed-state')
  })

  it('forwards a resource-bound Search authorization to the existing provider', async () => {
    const req = request({
      client_id: 'mcp-client',
      response_type: 'code',
      redirect_uri: 'https://client.example/callback',
      scope: 'search:read offline_access',
      resource: `${BASE_URL}/api/mcp/search/organizations/org-1`,
    })
    expect((await GET(req)).status).toBe(302)
    expect(mocks.betterAuthGET).toHaveBeenCalledWith(req)
    expect(mocks.createConnection).not.toHaveBeenCalled()
  })

  it.each([
    { scope: 'search:read' },
    { scope: 'api:read', resource: `${BASE_URL}/api/mcp/search/organizations/org-1` },
    { scope: 'search:read unknown', resource: `${BASE_URL}/api/mcp/search/organizations/org-1` },
    { scope: 'search:read', resource: 'https://evil.example/api/mcp/search/org-1' },
  ])('refuses ambiguous or overly broad Search grants: %o', async (params) => {
    const response = await GET(
      request({
        client_id: 'mcp-client',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        ...params,
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it('narrows issuer-wide scope requests before the provider signs Search consent', async () => {
    const req = request({
      client_id: 'mcp-client',
      response_type: 'code',
      redirect_uri: 'https://client.example/callback',
      scope: 'offline_access api:read api:write search:read',
      resource: `${BASE_URL}/api/mcp/search/organizations/org-1`,
    })
    expect((await GET(req)).status).toBe(302)
    const forwarded: Request = mocks.betterAuthGET.mock.calls[0][0]
    expect(new URL(forwarded.url).searchParams.get('scope')).toBe('search:read offline_access')
    expect(new URL(forwarded.url).searchParams.get('resource')).toBe(
      req.nextUrl.searchParams.get('resource')
    )
    expect(req.nextUrl.searchParams.get('scope')).toContain('api:write')
  })

  it('forwards a provider request without entering the connector flow', async () => {
    const providerRequest = request({
      client_id: 'client-1',
      response_type: 'code',
      redirect_uri: 'https://client.example/callback',
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

  it.each([
    ['https://client.example/callback', 'https://client.example/callback'],
    ['http://127.0.0.1/callback', 'http://127.0.0.1:43123/callback'],
  ])('returns permission denials to registered callback %s', async (registered, redirectUri) => {
    queueTableRows(schemaMock.oauthClient, [{ disabled: false, redirectUris: [registered] }])
    mocks.betterAuthGET.mockResolvedValue(
      Response.json(
        {
          error: 'access_denied',
          error_description: 'OAuth apps are restricted for your account.',
        },
        { status: 403 }
      )
    )

    const response = await GET(
      request({
        client_id: 'client-1',
        response_type: 'code',
        redirect_uri: redirectUri,
        state: 'state-1',
      })
    )
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('error_description')).toBe(
      'OAuth apps are restricted for your account.'
    )
    expect(location.searchParams.get('state')).toBe('state-1')
    expect(location.searchParams.get('iss')).toBe(`${BASE_URL}/api/auth`)
    expect(location.searchParams.has('code')).toBe(false)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it.each([
    ['missing client', undefined],
    ['disabled client', { disabled: true, redirectUris: ['https://client.example/callback'] }],
    ['unregistered callback', { disabled: false, redirectUris: ['https://client.example/other'] }],
  ])('does not redirect a permission denial for a %s', async (_case, client) => {
    if (client) queueTableRows(schemaMock.oauthClient, [client])
    mocks.betterAuthGET.mockResolvedValue(
      Response.json({ error: 'access_denied' }, { status: 403 })
    )

    const response = await GET(
      request({
        client_id: 'client-1',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        state: 'state-1',
      })
    )

    expect(response.status).toBe(400)
    expect(response.headers.has('location')).toBe(false)
    await expect(response.json()).resolves.toEqual({
      error: 'access_denied',
      error_description: 'Access denied.',
    })
  })

  it.each([
    [403, '{"error":"invalid_request"}'],
    [403, '<html>Forbidden</html>'],
    [400, '{"error":"access_denied"}'],
  ])('preserves delegated status %s and body %s', async (status, body) => {
    mocks.betterAuthGET.mockResolvedValue(new Response(body, { status }))

    const response = await GET(
      request({
        client_id: 'client-1',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
      })
    )

    expect(response.status).toBe(status)
    expect(response.headers.has('location')).toBe(false)
    await expect(response.text()).resolves.toBe(body)
  })

  it('requires authentication for provider authorization', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await GET(
      request({
        client_id: 'client-1',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
      })
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('preserves connector authorization when user authentication is disabled', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await GET(request({ draftId: 'draft-1' }))
    expect(response.status).toBe(307)
    expect(mocks.launchConnection).toHaveBeenCalled()
    expect(mocks.linkAccount).toHaveBeenCalled()
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it('keeps an OAuth request missing client_id out of the connector flow', async () => {
    const response = await GET(
      request({ response_type: 'code', redirect_uri: 'https://client.example/callback' })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it.each(['scope', 'state', 'nonce', 'prompt'])(
    'does not let an isolated %s parameter enter the connector flow',
    async (parameter) => {
      const response = await GET(
        request({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          [parameter]: 'value',
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
      expect(mocks.getSession).not.toHaveBeenCalled()
      expect(mocks.createConnection).not.toHaveBeenCalled()
      expect(mocks.betterAuthGET).not.toHaveBeenCalled()
    }
  )

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
    'resource',
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

  it.each([
    [{ code_challenge: 'a'.repeat(43) }, 'unpaired challenge'],
    [{ code_challenge_method: 'S256' }, 'unpaired method'],
    [{ code_challenge: 'a'.repeat(42), code_challenge_method: 'S256' }, 'malformed challenge'],
    [{ code_challenge: 'a'.repeat(43), code_challenge_method: 'plain' }, 'unsupported method'],
  ])('rejects %s PKCE parameters before Better Auth', async (parameters) => {
    const response = await GET(
      request({
        client_id: 'sim-cli',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        ...parameters,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it('accepts a canonical S256 challenge and rejects unsupported resource audiences', async () => {
    const acceptedRequest = request({
      client_id: 'sim-cli',
      response_type: 'code',
      redirect_uri: 'https://client.example/callback',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    })
    const accepted = await GET(acceptedRequest)
    const resource = await GET(
      request({
        client_id: 'sim-cli',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        resource: 'https://api.example.test',
      })
    )

    expect(accepted.status).toBe(302)
    expect(mocks.betterAuthGET).toHaveBeenCalledWith(acceptedRequest)
    expect(resource.status).toBe(400)
    await expect(resource.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('redirects a malformed request only to its registered callback with state and issuer', async () => {
    queueTableRows(schemaMock.oauthClient, [
      { disabled: false, redirectUris: ['http://127.0.0.1/callback'] },
    ])

    const response = await GET(
      request({
        client_id: 'sim-cli',
        response_type: 'code',
        redirect_uri: 'http://127.0.0.1:43123/callback',
        state: 'state-1',
        code_challenge: 'too-short',
        code_challenge_method: 'S256',
      })
    )
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(location.origin).toBe('http://127.0.0.1:43123')
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('state')).toBe('state-1')
    expect(location.searchParams.get('iss')).toBe(`${BASE_URL}/api/auth`)
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it('returns the authorization-specific error code to a registered callback', async () => {
    queueTableRows(schemaMock.oauthClient, [
      { disabled: false, redirectUris: ['https://client.example/callback'] },
    ])

    const response = await GET(
      request({
        client_id: 'client-1',
        response_type: 'token',
        redirect_uri: 'https://client.example/callback',
        state: 'state-1',
      })
    )
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(location.searchParams.get('error')).toBe('unsupported_response_type')
    expect(location.searchParams.get('state')).toBe('state-1')
    expect(mocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'preserves legacy connector linking with authentication disabled=%s',
    async (authDisabled) => {
      setEnvFlags({ isAuthDisabled: authDisabled })
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
    }
  )

  it('requires a configured OAuth client before creating a legacy draft', async () => {
    mocks.requireClient.mockImplementationOnce(() => {
      throw new Error('OAuth client is not configured')
    })

    const response = await GET(request({ providerId: 'google-email', workspaceId: WORKSPACE_ID }))

    expect(response.headers.get('location')).toBe(`${BASE_URL}/home?error=oauth_link_failed`)
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
      `${BASE_URL}/home?error=credential_provider_mismatch`
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

    expect(response.headers.get('location')).toBe(`${BASE_URL}/home?error=workspace_access_denied`)
  })

  it('redirects a draft launch infrastructure failure through the browser error contract', async () => {
    mocks.launchConnection.mockRejectedValue(new Error('Database unavailable'))

    const response = await GET(request({ draftId: 'draft-1' }))

    expect(response.headers.get('location')).toBe(`${BASE_URL}/home?error=oauth_link_failed`)
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

  it('starts QuickBooks with the write-only app configuration bound to its draft', async () => {
    mocks.launchConnection.mockResolvedValue({
      draft: {
        id: 'draft-1',
        providerId: 'quickbooks',
        workspaceId: WORKSPACE_ID,
        credentialId: null,
        oauthConfig: 'encrypted-config',
      },
    })
    const callbackURL = `${BASE_URL}/workspace/${WORKSPACE_ID}/integrations`

    const response = await GET(request({ draftId: 'draft-1', callbackURL }))
    const location = new URL(response.headers.get('location') ?? '')

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.decryptQuickBooksClientConfig).toHaveBeenCalledWith('encrypted-config')
    expect(mocks.createQuickBooksState).toHaveBeenCalledWith({
      userId: 'user-1',
      draftId: 'draft-1',
      returnUrl: callbackURL,
    })
    expect(location.origin + location.pathname).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: 'intuit-client-id',
      response_type: 'code',
      scope: 'openid profile email com.intuit.quickbooks.accounting',
      redirect_uri: `${BASE_URL}/api/auth/oauth2/callback/quickbooks`,
      state: 'signed-state',
    })
    expect(mocks.linkAccount).not.toHaveBeenCalled()
  })
})
