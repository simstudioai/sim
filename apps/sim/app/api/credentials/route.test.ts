/**
 * Tests for the workspace credentials API route (create path).
 *
 * @vitest-environment node
 */
import { auditMock, authMockFns, createMockRequest, posthogServerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const {
  mockCheckWorkspaceAccess,
  mockGetWorkspaceMembership,
  mockVerifyAndBuildServiceAccountSecret,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetWorkspaceMembership: vi.fn(),
  mockVerifyAndBuildServiceAccountSecret: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceMembership: mockGetWorkspaceMembership,
}))

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/oauth', () => ({
  getServiceConfigByProviderId: vi.fn(),
}))

vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  AtlassianValidationError: class AtlassianValidationError extends Error {},
}))

vi.mock('@/lib/credentials/service-account-secret', () => ({
  verifyAndBuildServiceAccountSecret: mockVerifyAndBuildServiceAccountSecret,
  ServiceAccountSecretError: class ServiceAccountSecretError extends Error {},
}))

import { POST } from '@/app/api/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

describe('POST /api/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    mockGetWorkspaceMembership.mockResolvedValue({ ownerId: 'user-1', memberUserIds: ['user-1'] })
  })

  describe('client-credential service accounts', () => {
    it('forwards clientId, clientSecret, and orgId to the secret builder on create', async () => {
      mockVerifyAndBuildServiceAccountSecret.mockResolvedValueOnce({
        providerId: 'zoom-service-account',
        encryptedServiceAccountKey: 'encrypted-blob',
        displayName: 'Zoom account acct_123',
        auditMetadata: { zoomAccountId: 'acct_123' },
      })

      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'zoom-client-id',
        clientSecret: 'zoom-secret',
        orgId: 'acct_123',
      })

      const response = await POST(req)

      expect(response.status).toBe(201)
      expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledTimes(1)
      expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
        'zoom-service-account',
        expect.objectContaining({
          clientId: 'zoom-client-id',
          clientSecret: 'zoom-secret',
          orgId: 'acct_123',
        })
      )
    })

    it('maps a verification failure to a 400 with the validation code', async () => {
      mockVerifyAndBuildServiceAccountSecret.mockRejectedValueOnce(
        new TokenServiceAccountValidationError('invalid_credentials', 400, {
          step: 'zoom_token_mint',
        })
      )

      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'zoom-client-id',
        clientSecret: 'zoom-secret',
        orgId: 'acct_123',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ code: 'invalid_credentials', error: 'invalid_credentials' })
    })

    it('maps a provider outage to a 502, not a 400', async () => {
      mockVerifyAndBuildServiceAccountSecret.mockRejectedValueOnce(
        new TokenServiceAccountValidationError('provider_unavailable', 502, {
          step: 'zoom_token_mint',
        })
      )

      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'zoom-client-id',
        clientSecret: 'zoom-secret',
        orgId: 'acct_123',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(502)
      expect(data).toEqual({ code: 'provider_unavailable', error: 'provider_unavailable' })
    })

    it('rejects a client-credential create missing the required fields', async () => {
      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'zoom-client-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('clientSecret is required')
      expect(mockVerifyAndBuildServiceAccountSecret).not.toHaveBeenCalled()
    })
  })
})
