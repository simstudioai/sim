/**
 * Tests for OAuth token API routes
 */
import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  createMockRequest,
  hybridAuthMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateManagedOAuthDelegation,
  mockAuthorizeCredentialUse,
  mockResolveManagedOAuthCredentialToken,
} = vi.hoisted(() => ({
  mockAuthenticateManagedOAuthDelegation: vi.fn(),
  mockAuthorizeCredentialUse: vi.fn(),
  mockResolveManagedOAuthCredentialToken: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
  authorizeCredentialUseForAuth: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/credentials/application/managed-oauth-delegation', () => ({
  authenticateManagedOAuthDelegation: mockAuthenticateManagedOAuthDelegation,
  InvalidManagedOAuthDelegationError: class InvalidManagedOAuthDelegationError extends Error {},
}))

vi.mock('@/lib/credentials/application/resolve-managed-oauth-token', () => ({
  resolveManagedOAuthCredentialToken: { execute: mockResolveManagedOAuthCredentialToken },
}))

import { createQuickBooksAccountId } from '@/lib/oauth/quickbooks'
import { GET, POST } from '@/app/api/auth/oauth/token/route'
import { getToolMetadata } from '@/tools/metadata'

const mockGetToolMetadata = vi.mocked(getToolMetadata)

describe('OAuth Token API Routes', () => {
  beforeEach(() => {
    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue(null)
  })

  /**
   * POST route tests
   */
  describe('POST handler', () => {
    it('returns realmId only for QuickBooks credentials', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accountId: createQuickBooksAccountId(
          '123456789',
          'intuit-subject-01234567-89ab-4def-8abc-0123456789ab',
          {
            clientId: 'client-id',
            environment: 'sandbox',
          }
        ),
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'quickbooks',
      })
      authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const response = await POST(
        createMockRequest('POST', {
          credentialId: 'credential-id',
        })
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        accessToken: 'fresh-token',
        credentialType: 'oauth',
        realmId: '123456789',
        quickBooksEnvironment: 'sandbox',
      })
    })

    it('rejects a malformed QuickBooks company identity with reconnect guidance', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accountId: 'malformed',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'quickbooks',
      })

      const response = await POST(
        createMockRequest('POST', {
          credentialId: 'credential-id',
        })
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toMatch(/Reconnect the QuickBooks credential/)
      expect(authOAuthUtilsMockFns.mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
    })

    it('does not authenticate managed delegation for an ordinary OAuth credential', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'internal_jwt',
        requesterUserId: 'workflow-owner-id',
        credentialOwnerUserId: 'workflow-owner-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      })
      authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const response = await POST(
        createMockRequest(
          'POST',
          { credentialId: 'credential-id', workflowId: 'workflow-id' },
          { 'x-sim-managed-oauth-delegation': 'Bearer stale-delegation' }
        )
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ accessToken: 'fresh-token' })
      expect(mockAuthenticateManagedOAuthDelegation).not.toHaveBeenCalled()
    })

    describe('managed OAuth path', () => {
      const managedCredential = {
        accountId: '',
        credentialId: 'managed-credential-id',
        credentialType: 'managed_oauth',
        providerId: 'google-email',
        workspaceId: 'workspace-id',
        usedCredentialTable: true,
      }

      beforeEach(() => {
        authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValueOnce(managedCredential)
        mockGetToolMetadata.mockReturnValue({
          oauth: {
            required: true,
            provider: 'google-email',
            requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          },
        })
      })

      it('fails closed when workflow delegation is missing', async () => {
        const response = await POST(
          createMockRequest('POST', {
            credentialId: 'managed-credential-id',
            toolId: 'gmail_read',
          })
        )

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toMatchObject({
          code: 'MANAGED_CREDENTIAL_DELEGATION_REQUIRED',
        })
        expect(mockResolveManagedOAuthCredentialToken).not.toHaveBeenCalled()
      })

      it('resolves a manually supplied managed credential ID with scoped delegation', async () => {
        const principal = {
          kind: 'delegated' as const,
          serviceId: 'executor' as const,
          subjectUserId: 'user-id',
          workspaceId: 'workspace-id',
          delegationId: 'delegation-id',
          audience: 'sim:managed-oauth-credentials',
          issuedAt: new Date(Date.now() - 1_000),
          expiresAt: new Date(Date.now() + 60_000),
          resourceScope: { credentialId: 'managed-credential-id' },
          delegationContext: {
            kind: 'workflow_execution' as const,
            workflowId: 'workflow-id',
          },
        }
        mockAuthenticateManagedOAuthDelegation.mockResolvedValueOnce(principal)
        mockResolveManagedOAuthCredentialToken.mockResolvedValueOnce({
          accessToken: 'managed-access-token',
          refreshed: false,
        })

        const response = await POST(
          createMockRequest(
            'POST',
            { credentialId: 'managed-credential-id', toolId: 'gmail_read' },
            { 'x-sim-managed-oauth-delegation': 'Bearer delegated-token' }
          )
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          accessToken: 'managed-access-token',
          credentialType: 'managed_oauth',
        })
        expect(mockResolveManagedOAuthCredentialToken).toHaveBeenCalledWith({
          principal,
          input: {
            credentialId: 'managed-credential-id',
            expectedProviderId: 'google-email',
            requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
            toolId: 'gmail_read',
          },
          request: expect.any(NextRequest),
        })
      })

      it('uses the trusted provider scope policy when a Slack tool omits narrower scopes', async () => {
        mockGetToolMetadata.mockReturnValueOnce({
          oauth: {
            required: true,
            provider: 'slack',
          },
        })
        const principal = {
          kind: 'delegated' as const,
          serviceId: 'executor' as const,
          subjectUserId: 'user-id',
          workspaceId: 'workspace-id',
          delegationId: 'delegation-id',
          audience: 'sim:managed-oauth-credentials',
          issuedAt: new Date(Date.now() - 1_000),
          expiresAt: new Date(Date.now() + 60_000),
          resourceScope: { credentialId: 'managed-credential-id' },
          delegationContext: {
            kind: 'workflow_execution' as const,
            workflowId: 'workflow-id',
          },
        }
        mockAuthenticateManagedOAuthDelegation.mockResolvedValueOnce(principal)
        mockResolveManagedOAuthCredentialToken.mockResolvedValueOnce({
          accessToken: 'managed-slack-token',
          refreshed: false,
        })

        const response = await POST(
          createMockRequest(
            'POST',
            { credentialId: 'managed-credential-id', toolId: 'slack_message' },
            { 'x-sim-managed-oauth-delegation': 'Bearer delegated-token' }
          )
        )

        expect(response.status).toBe(200)
        expect(mockResolveManagedOAuthCredentialToken).toHaveBeenCalledWith({
          principal,
          input: {
            credentialId: 'managed-credential-id',
            expectedProviderId: 'slack',
            requiredScopes: expect.arrayContaining([
              'channels:read',
              'channels:history',
              'chat:write',
            ]),
            toolId: 'slack_message',
          },
          request: expect.any(NextRequest),
        })
      })
    })

    describe('credentialAccountUserId + providerId path', () => {
      it('should reject internal JWT authentication', async () => {
        hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'internal_jwt',
          userId: 'test-user-id',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data).toHaveProperty('error', 'User not authenticated')
        expect(authOAuthUtilsMockFns.mockGetOAuthToken).not.toHaveBeenCalled()
      })

      it('should reject requests for other users credentials', async () => {
        hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'attacker-user-id',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'victim-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data).toHaveProperty('error', 'Unauthorized')
        expect(authOAuthUtilsMockFns.mockGetOAuthToken).not.toHaveBeenCalled()
      })
    })
  })

  /**
   * GET route tests
   */
  describe('GET handler', () => {
    it('rejects a malformed QuickBooks identity before reporting a missing token', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accountId: 'malformed',
        accessToken: null,
        refreshToken: 'refresh-token',
        providerId: 'quickbooks',
      })

      const response = await GET(
        createMockRequest(
          'GET',
          undefined,
          {},
          'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
        )
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toMatch(/Reconnect the QuickBooks credential/)
      expect(authOAuthUtilsMockFns.mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
    })
  })
})

describe('Salesforce instance URL resolution', () => {
  const INSTANCE = 'https://acme--sbx.sandbox.my.salesforce.com'

  beforeEach(() => {
    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue(null)
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: true,
      authType: 'session',
      requesterUserId: 'test-user-id',
      credentialOwnerUserId: 'owner-user-id',
    })
    authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshed: false,
    })
  })

  /**
   * The org host is smuggled through `scope` because the token response has
   * nowhere to put it; the tools read it back as their `instanceUrl` param.
   */
  function credentialForProvider(providerId: string) {
    return {
      id: 'credential-id',
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      providerId,
      scope: `__sf_instance__:${INSTANCE} api refresh_token openid`,
    }
  }

  it.each(['salesforce', 'salesforce-sandbox'])(
    'returns the stored instance URL for a %s credential',
    async (providerId) => {
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce(
        credentialForProvider(providerId)
      )

      const response = await POST(createMockRequest('POST', { credentialId: 'credential-id' }))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.instanceUrl).toBe(INSTANCE)
    }
  )

  it('omits instanceUrl for a non-Salesforce provider carrying a lookalike scope', async () => {
    authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
      ...credentialForProvider('google'),
    })

    const response = await POST(createMockRequest('POST', { credentialId: 'credential-id' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.instanceUrl).toBeUndefined()
  })
})
