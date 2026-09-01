/**
 * Tests for the workspace credentials API route (create path).
 *
 * @vitest-environment node
 */
import { credential } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  posthogServerMock,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const {
  mockCheckWorkspaceAccess,
  mockGetCredentialActorContext,
  mockGetCredentialCreationWorkspaceContext,
  mockGetBlockVisibility,
  mockCreateIntegrationCredentialVisibility,
  mockIsCredentialVisible,
  mockLoadWorkspace,
  mockResolveWorkspacePermission,
  mockSyncWorkspaceOAuthCredentials,
  mockVerifyAndBuildServiceAccountSecret,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
  mockGetCredentialCreationWorkspaceContext: vi.fn(),
  mockGetBlockVisibility: vi.fn(),
  mockCreateIntegrationCredentialVisibility: vi.fn(),
  mockIsCredentialVisible: vi.fn(),
  mockLoadWorkspace: vi.fn(),
  mockResolveWorkspacePermission: vi.fn(),
  mockSyncWorkspaceOAuthCredentials: vi.fn(),
  mockVerifyAndBuildServiceAccountSecret: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: mockGetBlockVisibility,
}))

vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: mockCreateIntegrationCredentialVisibility,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mockLoadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mockResolveWorkspacePermission,
}))

vi.mock('@/lib/credentials/access', () => ({
  canUseCredential: (access: { member: unknown; isAdmin: boolean; hasWorkspaceAccess: boolean }) =>
    access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin),
  getCredentialActorContext: mockGetCredentialActorContext,
  isSharedCredentialType: (type: string) => type !== 'env_personal',
  requireOrdinaryCredentialType: (type: string) => {
    if (type === 'managed_oauth') throw new Error('Managed OAuth credential reached test surface')
    return type
  },
  SHARED_CREDENTIAL_TYPES: ['oauth', 'env_workspace', 'service_account'],
}))

vi.mock('@/lib/credentials/environment', () => ({
  getCredentialCreationWorkspaceContext: mockGetCredentialCreationWorkspaceContext,
}))

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: mockSyncWorkspaceOAuthCredentials,
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

import { GET, POST } from '@/app/api/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'user-1',
}

describe('GET /api/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
      session: { id: 'session-1' },
    })
    mockLoadWorkspace.mockResolvedValue(WORKSPACE_CONTEXT)
    mockResolveWorkspacePermission.mockResolvedValue('read')
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      canAdmin: false,
    })
    mockGetBlockVisibility.mockResolvedValue({
      revealed: new Set(),
      disabled: new Set(),
      previewTagged: new Set(),
    })
    mockIsCredentialVisible.mockReturnValue(true)
    mockCreateIntegrationCredentialVisibility.mockReturnValue({
      isCredentialVisible: mockIsCredentialVisible,
      isOAuthServiceVisible: vi.fn(),
    })
  })

  it('reports an owned personal secret as raw-view admin without a membership row', async () => {
    queueTableRows(credential, [
      {
        id: 'credential-1',
        workspaceId: WORKSPACE_ID,
        type: 'env_personal',
        displayName: 'MY_API_KEY',
        description: null,
        unredacted: false,
        providerId: null,
        accountId: null,
        envKey: 'MY_API_KEY',
        envOwnerUserId: 'user-1',
        createdBy: 'user-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        memberRole: null,
      },
    ])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/credentials?workspaceId=${WORKSPACE_ID}`
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.credentials).toEqual([
      expect.objectContaining({
        id: 'credential-1',
        type: 'env_personal',
        envKey: 'MY_API_KEY',
        envOwnerUserId: 'user-1',
        role: 'admin',
      }),
    ])
    expect(mockGetBlockVisibility).not.toHaveBeenCalled()
  })

  it('hides a service-account credential when its gating block is preview-hidden', async () => {
    mockIsCredentialVisible.mockReturnValue(false)
    queueTableRows(credential, [
      {
        id: 'slack-credential',
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        displayName: 'Slack custom bot',
        description: null,
        unredacted: false,
        providerId: 'slack-custom-bot',
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        memberRole: 'admin',
      },
      {
        id: 'google-credential',
        workspaceId: WORKSPACE_ID,
        type: 'oauth',
        displayName: 'Google account',
        description: null,
        unredacted: false,
        providerId: 'google-email',
        accountId: 'google-account',
        envKey: null,
        envOwnerUserId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        memberRole: 'admin',
      },
    ])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/credentials?workspaceId=${WORKSPACE_ID}`
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      credentials: [expect.objectContaining({ id: 'google-credential' })],
    })
    expect(mockGetBlockVisibility).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-1' })
    expect(mockCreateIntegrationCredentialVisibility).toHaveBeenCalledWith({
      allowedIntegrationTypes: null,
      blockVisibility: {
        revealed: new Set(),
        disabled: new Set(),
        previewTagged: new Set(),
      },
    })
    expect(mockIsCredentialVisible).toHaveBeenCalledExactlyOnceWith({
      providerId: 'slack-custom-bot',
      type: 'service_account',
    })
  })

  it('normalizes padded, blank, and duplicate legacy query values', async () => {
    queueTableRows(credential, [])
    const url = new URL('http://localhost:3000/api/credentials')
    url.searchParams.append('workspaceId', ` ${WORKSPACE_ID} `)
    url.searchParams.append('workspaceId', 'not-the-selected-value')
    url.searchParams.set('type', '')
    url.searchParams.set('providerId', '')
    url.searchParams.set('credentialId', ' ')

    const response = await GET(createMockRequest('GET', undefined, {}, url.toString()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ credentials: [] })
    expect(mockLoadWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('uses the legacy workspace-scoped id/account lookup without sync, filters, or shape drift', async () => {
    queueTableRows(credential, [])
    queueTableRows(credential, [
      {
        id: 'credential-1',
        displayName: 'Google account',
        type: 'oauth',
        providerId: 'google-email',
      },
    ])
    const url = new URL('http://localhost:3000/api/credentials')
    url.searchParams.set('workspaceId', WORKSPACE_ID)
    url.searchParams.set('credentialId', ' account-1 ')
    url.searchParams.set('type', 'env_workspace')
    url.searchParams.set('providerId', 'different-provider')

    const response = await GET(createMockRequest('GET', undefined, {}, url.toString()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      credential: {
        id: 'credential-1',
        displayName: 'Google account',
        type: 'oauth',
        providerId: 'google-email',
      },
    })
    expect(mockSyncWorkspaceOAuthCredentials).not.toHaveBeenCalled()
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockGetBlockVisibility).not.toHaveBeenCalled()
  })
})

describe('POST /api/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
      session: { id: 'session-1' },
    })
    mockLoadWorkspace.mockResolvedValue(WORKSPACE_CONTEXT)
    mockResolveWorkspacePermission.mockResolvedValue('write')
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    mockGetCredentialCreationWorkspaceContext.mockResolvedValue({
      ownerId: 'user-1',
      organizationId: 'org-1',
      memberUserIds: ['user-1'],
      canWrite: true,
    })
    mockGetCredentialActorContext.mockResolvedValue({
      credential: {
        id: 'credential-1',
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        displayName: 'Service account',
        description: null,
        unredacted: false,
        providerId: 'zoom-service-account',
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        encryptedServiceAccountKey: 'encrypted-blob',
        createdBy: 'user-1',
        createdAt: new Date('2026-08-11T00:00:00.000Z'),
        updatedAt: new Date('2026-08-11T00:00:00.000Z'),
      },
      member: { role: 'admin', status: 'active' },
      hasWorkspaceAccess: true,
      canWriteWorkspace: true,
      isAdmin: true,
    })
  })

  describe('client-credential service accounts', () => {
    it('forwards clientId, clientSecret, and orgId to the secret builder on create', async () => {
      mockVerifyAndBuildServiceAccountSecret.mockResolvedValueOnce({
        providerId: 'zoom-service-account',
        encryptedServiceAccountKey: 'encrypted-blob',
        displayName: 'Zoom account acct_123',
        auditMetadata: { principalKind: 'tenant', principalId: 'acct_123' },
        principal: { kind: 'tenant', id: 'acct_123' },
      })
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(credential, [
        {
          id: 'credential-1',
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          displayName: 'Zoom account acct_123',
          description: null,
          unredacted: false,
          providerId: 'zoom-service-account',
          accountId: null,
          envKey: null,
          envOwnerUserId: null,
          encryptedServiceAccountKey: 'encrypted-blob',
          createdBy: 'user-1',
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
          updatedAt: new Date('2026-08-11T00:00:00.000Z'),
        },
      ])

      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'zoom-client-id',
        clientSecret: 'zoom-secret',
        orgId: 'acct_123',
      })

      const response = await POST(req)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.credential).not.toHaveProperty('encryptedServiceAccountKey')
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

    it('threads NetSuite certificate credentials through the create contract', async () => {
      mockVerifyAndBuildServiceAccountSecret.mockResolvedValueOnce({
        providerId: 'netsuite-service-account',
        encryptedServiceAccountKey: 'encrypted-netsuite-blob',
        displayName: 'Oracle NetSuite 1234567',
        auditMetadata: { principalKind: 'tenant', principalId: '1234567' },
        principal: { kind: 'tenant', id: '1234567' },
      })
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(credential, [
        {
          id: 'credential-netsuite',
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          displayName: 'Oracle NetSuite 1234567',
          description: null,
          unredacted: false,
          providerId: 'netsuite-service-account',
          accountId: null,
          envKey: null,
          envOwnerUserId: null,
          encryptedServiceAccountKey: 'encrypted-netsuite-blob',
          createdBy: 'user-1',
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
          updatedAt: new Date('2026-08-11T00:00:00.000Z'),
        },
      ])

      const response = await POST(
        createMockRequest('POST', {
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'netsuite-service-account',
          orgId: 'https://1234567.suitetalk.api.netsuite.com',
          clientId: 'netsuite-client-id',
          certificateId: 'netsuite-certificate-id',
          privateKey: '-----BEGIN PRIVATE KEY-----key',
        })
      )

      expect(response.status).toBe(201)
      expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
        'netsuite-service-account',
        expect.objectContaining({
          orgId: 'https://1234567.suitetalk.api.netsuite.com',
          clientId: 'netsuite-client-id',
          certificateId: 'netsuite-certificate-id',
          privateKey: '-----BEGIN PRIVATE KEY-----key',
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

    /**
     * A provider outage is `503`, matching `PROVIDER_OUTAGE_CODES` and the v2
     * surface. It was `502` here alone — the same failure rendered three ways
     * across the two surfaces and the shared status helper.
     */
    it('maps a provider outage to a 503 with a Retry-After, not a 400', async () => {
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

      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('5')
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

    it('re-authorizes a personal credential after the shared org/user locks', async () => {
      mockGetCredentialCreationWorkspaceContext
        .mockResolvedValueOnce({
          ownerId: 'user-1',
          organizationId: 'org-1',
          memberUserIds: ['user-1'],
          canWrite: true,
        })
        .mockResolvedValueOnce({
          ownerId: 'org-owner',
          organizationId: 'org-1',
          memberUserIds: ['org-owner'],
          canWrite: false,
        })

      const req = createMockRequest('POST', {
        workspaceId: WORKSPACE_ID,
        type: 'env_personal',
        envKey: 'MY_API_KEY',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toEqual({ error: 'Write permission required' })
      expect(mockGetCredentialCreationWorkspaceContext).toHaveBeenCalledTimes(2)
      expect(dbChainMockFns.execute).toHaveBeenCalled()
      expect(mockGetCredentialCreationWorkspaceContext.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.execute.mock.invocationCallOrder[0]
      )
      expect(dbChainMockFns.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockGetCredentialCreationWorkspaceContext.mock.invocationCallOrder[1]
      )
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })
  })
})
