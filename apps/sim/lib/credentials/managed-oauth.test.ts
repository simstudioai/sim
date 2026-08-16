/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBilling: vi.fn(),
  isAvailable: vi.fn(),
  getAdapter: vi.fn(),
  decryptSecret: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.getBilling,
}))

vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: mocks.isAvailable,
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapterByProviderId: mocks.getAdapter,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: vi.fn(),
}))

import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'

describe('managed OAuth token resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getBilling.mockResolvedValue({ plan: 'enterprise' })
    mocks.isAvailable.mockResolvedValue(true)
    mocks.decryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-oauth-token-set',
        version: 1,
        tokenType: 'Bearer',
        accessToken: 'xoxp-slack-token',
      }),
    })
    mocks.getAdapter.mockReturnValue({
      getPolicy: vi.fn().mockResolvedValue({
        authorizationAppId: 'slack:A123:T123',
        scopeVersion: 1,
      }),
      hasRequiredScopes: vi.fn().mockReturnValue(true),
    })
  })

  it('uses a non-expiring Slack access token without entering refresh', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'managed_oauth',
        providerId: 'slack',
        authorizationAppId: 'slack:A123:T123',
        managedOauthScopeVersion: 1,
        managedOauthStatus: 'active',
        grantedScopes: ['chat:write'],
        encryptedOauthTokenSet: 'encrypted-token-set',
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    ])

    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: ['chat:write'],
      })
    ).resolves.toEqual({ accessToken: 'xoxp-slack-token', refreshed: false })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
