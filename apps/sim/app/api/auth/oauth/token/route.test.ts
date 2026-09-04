/**
 * Tests for OAuth token API routes
 *
 * @vitest-environment node
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
  mockGetToolMetadata,
  mockResolveManagedOAuthCredentialToken,
  mockResolveServiceAccountToken,
} = vi.hoisted(() => ({
  mockAuthenticateManagedOAuthDelegation: vi.fn(),
  mockAuthorizeCredentialUse: vi.fn(),
  mockGetToolMetadata: vi.fn(),
  mockResolveManagedOAuthCredentialToken: vi.fn(),
  mockResolveServiceAccountToken: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  ...authOAuthUtilsMock,
  resolveServiceAccountToken: mockResolveServiceAccountToken,
}))

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

vi.mock('@/tools/metadata', () => ({ getToolMetadata: mockGetToolMetadata }))

import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { GET, POST } from '@/app/api/auth/oauth/token/route'

describe('OAuth Token API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue(null)
  })

  /**
   * POST route tests
   */
  describe('POST handler', () => {
    it('should return access token successfully', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
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

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(authOAuthUtilsMockFns.mockGetCredential).toHaveBeenCalled()
      expect(authOAuthUtilsMockFns.mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle workflowId for server-side authentication', async () => {
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

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'workflow-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(authOAuthUtilsMockFns.mockGetCredential).toHaveBeenCalled()
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

    it('should handle missing credentialId', async () => {
      const req = createMockRequest('POST', {})

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty(
        'error',
        'Either credentialId or (credentialAccountUserId + providerId) is required'
      )
    })

    it('should handle authentication failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: false,
        error: 'Authentication required',
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should handle workflow not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Workflow not found' })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'nonexistent-workflow-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
    })

    it('should handle credential not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'nonexistent-credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error')
    })

    it('should handle token refresh failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        providerId: 'google',
      })
      authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockRejectedValueOnce(
        new Error('Refresh failure')
      )

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Failed to refresh access token')
    })

    describe('service account path', () => {
      it('threads the NetSuite SuiteTalk instance URL into the token response', async () => {
        const instanceUrl = 'https://1234567.suitetalk.api.netsuite.com'
        const resolvedCredential = {
          accountId: '',
          credentialId: 'netsuite-credential-id',
          credentialType: 'service_account',
          providerId: 'netsuite-service-account',
          workspaceId: 'workspace-id',
          usedCredentialTable: true,
        } as const
        authOAuthUtilsMockFns.mockResolveOAuthAccountId
          .mockResolvedValueOnce(resolvedCredential)
          .mockResolvedValueOnce(resolvedCredential)
        mockAuthorizeCredentialUse.mockResolvedValueOnce({
          ok: true,
          authType: 'session',
          requesterUserId: 'test-user-id',
          workspaceId: 'workspace-id',
          resolvedCredentialId: 'netsuite-credential-id',
        })
        mockResolveServiceAccountToken.mockResolvedValueOnce({
          accessToken: 'netsuite-token',
          instanceUrl,
        })

        const response = await POST(
          createMockRequest('POST', { credentialId: 'netsuite-credential-id' })
        )
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data).toMatchObject({ accessToken: 'netsuite-token', instanceUrl })
      })

      it('should thread authStyle from the resolver into the response', async () => {
        const resolvedCredential = {
          accountId: '',
          credentialId: 'sa-credential-id',
          credentialType: 'service_account',
          providerId: 'pipedrive-service-account',
          workspaceId: 'workspace-id',
          usedCredentialTable: true,
        } as const
        authOAuthUtilsMockFns.mockResolveOAuthAccountId
          .mockResolvedValueOnce(resolvedCredential)
          .mockResolvedValueOnce(resolvedCredential)
        mockAuthorizeCredentialUse.mockResolvedValueOnce({
          ok: true,
          authType: 'session',
          requesterUserId: 'test-user-id',
          workspaceId: 'workspace-id',
          resolvedCredentialId: 'sa-credential-id',
        })
        mockResolveServiceAccountToken.mockResolvedValueOnce({
          accessToken: 'pasted-api-token',
          authStyle: 'x-api-token',
        })

        const req = createMockRequest('POST', { credentialId: 'sa-credential-id' })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data).toHaveProperty('accessToken', 'pasted-api-token')
        expect(data).toHaveProperty('authStyle', 'x-api-token')
      })

      it('should omit authStyle for Bearer token-paste providers', async () => {
        const resolvedCredential = {
          accountId: '',
          credentialId: 'sa-credential-id',
          credentialType: 'service_account',
          providerId: 'hubspot-service-account',
          workspaceId: 'workspace-id',
          usedCredentialTable: true,
        } as const
        authOAuthUtilsMockFns.mockResolveOAuthAccountId
          .mockResolvedValueOnce(resolvedCredential)
          .mockResolvedValueOnce(resolvedCredential)
        mockAuthorizeCredentialUse.mockResolvedValueOnce({
          ok: true,
          authType: 'session',
          requesterUserId: 'test-user-id',
          workspaceId: 'workspace-id',
          resolvedCredentialId: 'sa-credential-id',
        })
        mockResolveServiceAccountToken.mockResolvedValueOnce({
          accessToken: 'pat-token',
        })

        const req = createMockRequest('POST', { credentialId: 'sa-credential-id' })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data).toHaveProperty('accessToken', 'pat-token')
        expect(data).not.toHaveProperty('authStyle')
      })

      it.each([
        ['invalid_credentials', 401],
        ['site_not_found', 400],
        ['provider_unavailable', 502],
      ] as const)(
        'surfaces the %s error code with status %i when the mint fails',
        async (code, status) => {
          const resolvedCredential = {
            accountId: '',
            credentialId: 'sa-credential-id',
            credentialType: 'service_account',
            providerId: 'salesforce-service-account',
            workspaceId: 'workspace-id',
            usedCredentialTable: true,
          } as const
          authOAuthUtilsMockFns.mockResolveOAuthAccountId
            .mockResolvedValueOnce(resolvedCredential)
            .mockResolvedValueOnce(resolvedCredential)
          mockAuthorizeCredentialUse.mockResolvedValueOnce({
            ok: true,
            authType: 'session',
            requesterUserId: 'test-user-id',
            workspaceId: 'workspace-id',
            resolvedCredentialId: 'sa-credential-id',
          })
          mockResolveServiceAccountToken.mockRejectedValueOnce(
            new TokenServiceAccountValidationError(code, status, { step: 'mint' })
          )

          const req = createMockRequest('POST', { credentialId: 'sa-credential-id' })
          const response = await POST(req)
          const data = await response.json()

          expect(response.status).toBe(status)
          // provider_unavailable is an infra failure, not a credential error, so
          // it intentionally does not carry a client-actionable `code`.
          if (code === 'provider_unavailable') {
            expect(data).not.toHaveProperty('code')
          } else {
            expect(data).toHaveProperty('code', code)
          }
        }
      )
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
      it('should reject unauthenticated requests', async () => {
        hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: false,
          error: 'Authentication required',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'target-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data).toHaveProperty('error', 'User not authenticated')
        expect(authOAuthUtilsMockFns.mockGetOAuthToken).not.toHaveBeenCalled()
      })

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

      it('should allow session-authenticated users to access their own credentials', async () => {
        hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'test-user-id',
        })
        authOAuthUtilsMockFns.mockGetOAuthToken.mockResolvedValueOnce('valid-access-token')

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data).toHaveProperty('accessToken', 'valid-access-token')
        expect(authOAuthUtilsMockFns.mockGetOAuthToken).toHaveBeenCalledWith(
          'test-user-id',
          'google'
        )
      })

      it('should return 404 when credential not found for user', async () => {
        hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'test-user-id',
        })
        authOAuthUtilsMockFns.mockGetOAuthToken.mockResolvedValueOnce(null)

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'nonexistent-provider',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toContain('No credential found')
      })
    })
  })

  /**
   * GET route tests
   */
  describe('GET handler', () => {
    it('should return access token successfully', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
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

      const req = new NextRequest(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(authOAuthUtilsMockFns.mockGetCredential).toHaveBeenCalled()
      expect(authOAuthUtilsMockFns.mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle missing credentialId', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/oauth/token')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Credential ID is required')
    })

    it('should handle authentication failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: false,
        error: 'Authentication required',
      })

      const req = new NextRequest(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should handle credential not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce(undefined)

      const req = new NextRequest(
        'http://localhost:3000/api/auth/oauth/token?credentialId=nonexistent-credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error')
    })

    it('should handle missing access token', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: null,
        refreshToken: 'refresh-token',
        providerId: 'google',
      })

      const req = new NextRequest(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it('should handle token refresh failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      authOAuthUtilsMockFns.mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        providerId: 'google',
      })
      authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockRejectedValueOnce(
        new Error('Refresh failure')
      )

      const req = new NextRequest(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error')
    })
  })
})

describe('Salesforce instance URL resolution', () => {
  const INSTANCE = 'https://acme--sbx.sandbox.my.salesforce.com'

  beforeEach(() => {
    vi.clearAllMocks()
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
