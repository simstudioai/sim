/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialConnectionProviderMismatchError } from '@/lib/credentials/application/connection-target'

const mocks = vi.hoisted(() => ({
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

vi.mock('@/lib/auth/auth', () => ({
  getSession: mocks.getSession,
  auth: { api: { oAuth2LinkAccount: mocks.linkAccount } },
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

describe('OAuth2 authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
