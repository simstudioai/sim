/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  resetEnvMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockOAuth2LinkAccount,
  mockCheckWorkspaceAccess,
  mockGetCredentialActorContext,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOAuth2LinkAccount: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

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

vi.mock('@/lib/oauth/utils', () => ({
  getAllOAuthServices: vi.fn(() => [{ providerId: 'google-email', name: 'Gmail' }]),
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
    setEnv({ NEXT_PUBLIC_APP_URL: BASE_URL })
    mockGetSession.mockResolvedValue({ user: { id: USER_ID } })
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
