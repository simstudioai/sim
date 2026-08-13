/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockOAuth2LinkAccount,
  mockCheckWorkspaceAccess,
  mockGetCredentialActorContext,
  mockLaunchCredentialConnection,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOAuth2LinkAccount: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
  mockLaunchCredentialConnection: vi.fn(),
}))

vi.mock('@/lib/auth/auth', () => ({
  auth: { api: { oAuth2LinkAccount: mockOAuth2LinkAccount } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))

vi.mock('@/lib/credentials/application/launch-credential-connection', () => ({
  launchCredentialConnection: {
    operation: { id: 'credentials.connections.launch' },
    execute: mockLaunchCredentialConnection,
  },
}))

vi.mock('@/lib/oauth/utils', () => ({
  getAllOAuthServices: vi.fn(() => [{ providerId: 'google-email', name: 'Gmail' }]),
  // Real implementation: a credential id matches its service's OAuth id, an
  // alternate authorization server, or the family's service-account id.
  credentialProviderMatchesService: (
    credentialProviderId: string,
    service: {
      providerId: string
      serviceAccountProviderId?: string
      additionalProviderIds?: readonly string[]
    }
  ) =>
    service.providerId === credentialProviderId ||
    service.serviceAccountProviderId === credentialProviderId ||
    (service.additionalProviderIds?.includes(credentialProviderId) ?? false),
}))

import { GET } from '@/app/api/auth/oauth2/authorize/route'

const BASE_URL = 'https://sim.test'
const WORKSPACE_ID = 'ws-1'
const USER_ID = 'user-1'
const CREDENTIAL_ID = 'cred-1'
const LINK_URL = 'https://provider.example/authorize?state=abc'

function authorizeRequest(query: Record<string, string>) {
  const url = new URL(`${BASE_URL}/api/auth/oauth2/authorize`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return createMockRequest('GET', undefined, {}, url.toString())
}

function oauthCredentialActor(overrides: Record<string, unknown> = {}) {
  return {
    credential: {
      id: CREDENTIAL_ID,
      workspaceId: WORKSPACE_ID,
      type: 'oauth',
      providerId: 'google-email',
      displayName: 'Work Gmail',
      ...((overrides.credential as Record<string, unknown>) ?? {}),
    },
    member: null,
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: true,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'credential')),
  }
}

describe('OAuth2 authorize route', () => {
  afterAll(() => {
    resetEnvMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({
      NEXT_PUBLIC_APP_URL: BASE_URL,
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })
    mockGetSession.mockResolvedValue({
      user: { id: USER_ID },
      session: { id: 'session-1' },
    })
    queueTableRows(schemaMock.user, [{ name: 'Test User' }])
    dbChainMockFns.onConflictDoUpdate.mockImplementation(() => ({
      returning: vi
        .fn()
        .mockResolvedValue([{ id: 'draft-1', expiresAt: new Date('2026-08-12T20:15:00.000Z') }]),
    }))
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      canAdmin: false,
      workspace: { id: WORKSPACE_ID },
    })
    mockOAuth2LinkAccount.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: LINK_URL }),
      headers: { getSetCookie: () => ['better-auth.state=xyz; Path=/'] },
    })
  })

  describe('draft-bound connection', () => {
    it('resolves the exact user-bound draft before starting OAuth', async () => {
      mockLaunchCredentialConnection.mockResolvedValue({
        draft: {
          id: 'draft-1',
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          providerId: 'google-email',
          displayName: "Test User's Gmail",
          description: null,
          credentialId: null,
          expiresAt: new Date('2026-08-12T20:15:00.000Z'),
          createdAt: new Date('2026-08-12T20:00:00.000Z'),
        },
      })
      const request = authorizeRequest({ draftId: 'draft-1' })

      const response = await GET(request)

      expect(response.headers.get('location')).toBe(LINK_URL)
      expect(mockLaunchCredentialConnection).toHaveBeenCalledWith({
        principal: { kind: 'session', userId: USER_ID, sessionId: 'session-1' },
        input: { draftId: 'draft-1' },
        request,
      })
      expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            providerId: 'google-email',
            callbackURL: `${BASE_URL}/oauth/credential-connected?result=connected`,
            errorCallbackURL: `${BASE_URL}/oauth/credential-connected?result=failed`,
          },
        })
      )
    })

    it('hands custom providers to their authenticated browser flow', async () => {
      setEnv({ TRELLO_API_KEY: 'trello-key' })
      mockLaunchCredentialConnection.mockResolvedValue({
        draft: {
          id: 'draft-1',
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          providerId: 'trello',
          displayName: "Test User's Trello",
          description: null,
          credentialId: null,
          expiresAt: new Date('2026-08-12T20:15:00.000Z'),
          createdAt: new Date('2026-08-12T20:00:00.000Z'),
        },
      })

      const response = await GET(authorizeRequest({ draftId: 'draft-1' }))

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/api/auth/trello/authorize?returnUrl=https%3A%2F%2Fsim.test%2Foauth%2Fcredential-connected%3Fresult%3Dconnected`
      )
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })
  })

  describe('plain connect (no credentialId)', () => {
    it('creates a draft with credentialId null and redirects to the provider', async () => {
      const response = await GET(
        authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID })
      )

      expect(response.headers.get('location')).toBe(LINK_URL)
      expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          providerId: 'google-email',
          credentialId: null,
        })
      )
      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ credentialId: null }),
        })
      )
    })

    it('numbers the draft display name when the default collides with an existing credential', async () => {
      dbChainMockFns.where
        .mockImplementationOnce(() => Promise.resolve([{ name: 'Justin' }]))
        .mockImplementationOnce(() => Promise.resolve([{ displayName: "Justin's Gmail" }]))

      await GET(authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID }))

      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Justin's Gmail 2" })
      )
    })

    it('nulls out credentialId in the upsert set so a stale reconnect draft cannot leak into a plain connect', async () => {
      await GET(authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID }))

      const [{ set }] = dbChainMockFns.onConflictDoUpdate.mock.calls[0]
      expect(set).toHaveProperty('credentialId', null)
    })

    it('rejects an OAuth client that is not configured for the deployment', async () => {
      setEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined })

      const response = await GET(
        authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID })
      )

      expect(response.headers.get('location')).toBe(`${BASE_URL}/workspace?error=oauth_link_failed`)
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })

    it('redirects to login when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const response = await GET(
        authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID })
      )

      expect(response.headers.get('location')).toContain('/login')
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('rejects without workspace write access', async () => {
      mockCheckWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canWrite: false,
        canAdmin: false,
        workspace: { id: WORKSPACE_ID },
      })

      const response = await GET(
        authorizeRequest({ providerId: 'google-email', workspaceId: WORKSPACE_ID })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=workspace_access_denied`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })
  })

  describe('reconnect (credentialId present)', () => {
    it('creates a reconnect draft carrying credentialId in values and upsert set', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor())

      const response = await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(response.headers.get('location')).toBe(LINK_URL)
      expect(mockGetCredentialActorContext).toHaveBeenCalledWith(
        CREDENTIAL_ID,
        USER_ID,
        expect.objectContaining({ workspaceAccess: expect.anything() })
      )
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ credentialId: CREDENTIAL_ID })
      )
      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ credentialId: CREDENTIAL_ID }),
        })
      )
    })

    it("uses the credential's actual display name for the reconnect draft (audit accuracy)", async () => {
      mockGetCredentialActorContext.mockResolvedValue(
        oauthCredentialActor({ credential: { displayName: 'Renamed By User' } })
      )

      await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Renamed By User' })
      )
    })

    it('rejects reconnect for custom-flow providers (trello/shopify) and writes no draft', async () => {
      for (const providerId of ['trello', 'shopify']) {
        const response = await GET(
          authorizeRequest({ providerId, workspaceId: WORKSPACE_ID, credentialId: CREDENTIAL_ID })
        )

        expect(response.headers.get('location')).toBe(
          `${BASE_URL}/workspace?error=credential_reconnect_unsupported`
        )
      }
      expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })

    it('rejects when the caller is not a credential admin and writes no draft', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor({ isAdmin: false }))

      const response = await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=credential_access_denied`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })

    it('rejects when the credential belongs to a different workspace', async () => {
      mockGetCredentialActorContext.mockResolvedValue(
        oauthCredentialActor({ credential: { workspaceId: 'ws-other' } })
      )

      const response = await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=credential_access_denied`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('rejects when the credential does not exist', async () => {
      mockGetCredentialActorContext.mockResolvedValue({
        credential: null,
        member: null,
        hasWorkspaceAccess: false,
        canWriteWorkspace: false,
        isAdmin: false,
      })

      const response = await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: 'cred-missing',
        })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=credential_access_denied`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('rejects a non-oauth credential', async () => {
      mockGetCredentialActorContext.mockResolvedValue(
        oauthCredentialActor({ credential: { type: 'env_workspace' } })
      )

      const response = await GET(
        authorizeRequest({
          providerId: 'google-email',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=credential_access_denied`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('rejects when the query providerId does not match the credential provider', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor())

      const response = await GET(
        authorizeRequest({
          providerId: 'slack',
          workspaceId: WORKSPACE_ID,
          credentialId: CREDENTIAL_ID,
        })
      )

      expect(response.headers.get('location')).toBe(
        `${BASE_URL}/workspace?error=credential_provider_mismatch`
      )
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockOAuth2LinkAccount).not.toHaveBeenCalled()
    })
  })
})
