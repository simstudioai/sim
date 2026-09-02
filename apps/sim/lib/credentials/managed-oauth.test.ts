/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBilling: vi.fn(),
  isAvailable: vi.fn(),
  getAdapter: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
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
  encryptSecret: mocks.encryptSecret,
}))

import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'

function mondayCredentialRow() {
  return {
    id: 'credential-1',
    workspaceId: 'workspace-1',
    type: 'managed_oauth',
    providerId: 'monday',
    authorizationAppId: 'monday:monday-client-1',
    managedOauthScopeVersion: 1,
    managedOauthStatus: 'active',
    grantedScopes: ['boards:read', 'me:read'],
    encryptedOauthTokenSet: 'encrypted-token-set',
    accessTokenExpiresAt: new Date('2026-09-01T11:00:00.000Z'),
    refreshTokenExpiresAt: null,
    credentialGroupId: 'group-1',
    credentialGroupEnrollmentId: 'enrollment-1',
  }
}

function mondayTokenResolutionParams() {
  return {
    credentialId: 'credential-1',
    workspaceId: 'workspace-1',
    expectedProviderId: 'monday',
    requiredScopes: ['boards:read', 'me:read'],
  }
}

describe('managed OAuth token resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
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

  afterEach(() => {
    vi.useRealTimers()
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

  it('refreshes an expired Monday credential and persists its rotated token set', async () => {
    const row = mondayCredentialRow()
    dbChainMockFns.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: row.id }])
    mocks.decryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-oauth-token-set',
        version: 1,
        tokenType: 'Bearer',
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
      }),
    })
    mocks.encryptSecret.mockResolvedValue({ encrypted: 'encrypted-rotated-token-set' })
    const refreshToken = vi.fn().mockResolvedValue({
      ok: true,
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresIn: 3600,
    })
    mocks.getAdapter.mockReturnValue({
      getPolicy: vi.fn().mockResolvedValue({
        authorizationAppId: row.authorizationAppId,
        scopeVersion: 1,
      }),
      hasRequiredScopes: vi.fn().mockReturnValue(true),
      refreshToken,
      isTerminalRefreshError: vi.fn().mockReturnValue(false),
    })

    await expect(resolveManagedOAuthToken(mondayTokenResolutionParams())).resolves.toEqual({
      accessToken: 'new-access-token',
      refreshed: true,
    })

    expect(refreshToken).toHaveBeenCalledWith('old-refresh-token')
    const [serializedTokenSet] = mocks.encryptSecret.mock.calls[0] as [string]
    expect(JSON.parse(serializedTokenSet)).toEqual({
      type: 'managed-oauth-token-set',
      version: 1,
      tokenType: 'Bearer',
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedOauthTokenSet: 'encrypted-rotated-token-set',
        accessTokenExpiresAt: new Date('2026-09-01T13:00:00.000Z'),
        lastRefreshedAt: new Date('2026-09-01T12:00:00.000Z'),
      })
    )
  })

  it('marks an expired Monday credential for reauthorization after a terminal refresh error', async () => {
    const row = mondayCredentialRow()
    dbChainMockFns.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
    mocks.decryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-oauth-token-set',
        version: 1,
        tokenType: 'Bearer',
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
      }),
    })
    const refreshToken = vi.fn().mockResolvedValue({
      ok: false,
      errorCode: 'invalid_grant',
      message: 'Refresh token rejected',
    })
    const isTerminalRefreshError = vi.fn().mockReturnValue(true)
    mocks.getAdapter.mockReturnValue({
      getPolicy: vi.fn().mockResolvedValue({
        authorizationAppId: row.authorizationAppId,
        scopeVersion: 1,
      }),
      hasRequiredScopes: vi.fn().mockReturnValue(true),
      refreshToken,
      isTerminalRefreshError,
    })

    await expect(resolveManagedOAuthToken(mondayTokenResolutionParams())).rejects.toMatchObject({
      code: 'MANAGED_CREDENTIAL_NEEDS_REAUTH',
      statusCode: 401,
    })

    expect(refreshToken).toHaveBeenCalledWith('old-refresh-token')
    expect(isTerminalRefreshError).toHaveBeenCalledWith('invalid_grant')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ managedOauthStatus: 'needs_reauth' })
    )
    expect(mocks.encryptSecret).not.toHaveBeenCalled()
  })
})
