/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBilling: vi.fn(),
  isAvailable: vi.fn(),
  getAdapter: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  slackConfiguration: vi.fn(),
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
vi.mock('@/lib/credential-groups/provider-configuration', () => ({
  getSlackCredentialGroupConfiguration: mocks.slackConfiguration,
}))
vi.mock('@/lib/credential-groups/slack-managed-users', () => ({
  getSlackCustomBotCredential: async () => ({ id: 'bot-1', teamId: 'T123' }),
  exchangeSlackUserAuthorization: vi.fn(),
  revokeSlackToken: vi.fn(),
  verifySlackUserIdentity: vi.fn(),
}))

import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { slackCredentialGroupProviderAdapter } from '@/lib/credential-groups/slack-provider'
import { createStandardOAuthCredentialGroupProviderAdapter } from '@/lib/credential-groups/standard-oauth-provider'
import { rejectManagedOAuthToken, resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'

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
        requiredScopes: ['chat:write'],
      }),
      hasRequiredScopes: vi.fn().mockReturnValue(true),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetEnvMock()
  })

  it('resolves a scopeless GitHub grant through the canonical provider policy', async () => {
    setEnv({ GITHUB_APP_CLIENT_ID: 'fixture-client', GITHUB_APP_CLIENT_SECRET: 'fixture-secret' })
    const adapter = createStandardOAuthCredentialGroupProviderAdapter('github-repositories')
    const policy = await adapter.getPolicy(undefined, { workspaceId: 'workspace-1' })
    expect(policy.requiredScopes).toEqual([])
    mocks.getAdapter.mockReturnValue(adapter)
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        ...mondayCredentialRow(),
        providerId: policy.providerId,
        authorizationAppId: policy.authorizationAppId,
        managedOauthScopeVersion: policy.scopeVersion,
        grantedScopes: [],
        accessTokenExpiresAt: new Date('2026-09-01T13:00:00Z'),
      },
    ])
    await expect(
      resolveManagedOAuthToken({
        ...mondayTokenResolutionParams(),
        expectedProviderId: policy.providerId,
        requiredScopes: [],
      })
    ).resolves.toMatchObject({ refreshed: false })
    expect(mocks.decryptSecret).toHaveBeenCalledWith('encrypted-token-set')
  })

  it.each([null, undefined])(
    'rejects missing granted-scope metadata: %s',
    async (grantedScopes) => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ ...mondayCredentialRow(), grantedScopes }])
      await expect(resolveManagedOAuthToken(mondayTokenResolutionParams())).rejects.toMatchObject({
        code: 'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
      })
      expect(mocks.decryptSecret).not.toHaveBeenCalled()
    }
  )

  it('rejects an empty grant when the provider policy requires scopes', async () => {
    mocks.getAdapter.mockReturnValue({
      getPolicy: vi.fn().mockResolvedValue({
        authorizationAppId: 'monday:monday-client-1',
        scopeVersion: 1,
        requiredScopes: ['boards:read', 'me:read'],
      }),
      hasRequiredScopes: (granted: string[], required: string[]) =>
        required.every((scope) => granted.includes(scope)),
    })
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...mondayCredentialRow(), grantedScopes: [] }])
    await expect(
      resolveManagedOAuthToken({ ...mondayTokenResolutionParams(), requiredScopes: [] })
    ).rejects.toMatchObject({ code: 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  function seedSlackSearchCredential(
    optionId = 'option-1',
    status = 'active',
    grantedScopes: readonly string[] = SLACK_SEARCH_USER_SCOPES
  ) {
    const scopes = [...SLACK_SEARCH_USER_SCOPES]
    const scopeVersion = credentialGroupScopePolicyVersion(scopes)
    mocks.getAdapter.mockReturnValue(slackCredentialGroupProviderAdapter)
    mocks.slackConfiguration.mockResolvedValue({
      slackBotCredentialId: 'bot-1',
      clientId: 'client',
      clientSecret: 'secret',
      appId: 'A123',
      teamId: 'T123',
      scopes,
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'credential-1',
          workspaceId: 'workspace-1',
          type: 'managed_oauth',
          providerId: 'slack',
          authorizationAppId: 'slack:A123:T123',
          managedOauthScopeVersion: scopeVersion,
          managedOauthStatus: 'active',
          grantedScopes: [...grantedScopes],
          encryptedOauthTokenSet: 'encrypted-token-set',
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          credentialGroupId: 'group-1',
          credentialGroupEnrollmentId: 'enrollment-1',
          credentialGroupOptionId: 'option-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          options: [
            {
              id: optionId,
              provider: 'slack',
              status,
              slackBotCredentialId: 'bot-1',
              requiredScopes: scopes,
              scopeVersion,
            },
          ],
        },
      ])
  }

  it('resolves a minimal Search token through the actual Slack adapter and its exact bound option', async () => {
    seedSlackSearchCredential()
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
      })
    ).resolves.toEqual({ accessToken: 'xoxp-slack-token', refreshed: false })
  })

  it.each([
    { name: 'replaced', optionId: 'replacement-option', status: 'active' },
    { name: 'disabled', optionId: 'option-1', status: 'disabled' },
  ])('refuses a token whose canonical Slack option was $name', async ({ optionId, status }) => {
    seedSlackSearchCredential(optionId, status)
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
      })
    ).rejects.toMatchObject({ code: 'MANAGED_CREDENTIAL_NEEDS_REAUTH' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  it('requires reauthorization after the current token is rejected', async () => {
    seedSlackSearchCredential()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'credential-1' }])
    expect(
      await rejectManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [],
        rejectedAccessToken: 'xoxp-slack-token',
      })
    ).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      managedOauthStatus: 'needs_reauth',
      updatedAt: expect.any(Date),
    })
  })

  it('preserves a token reconnected before rejection was reported', async () => {
    seedSlackSearchCredential()
    expect(
      await rejectManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [],
        rejectedAccessToken: 'previous-token',
      })
    ).toBe(false)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('does not report rejection when a concurrent reconnect wins the conditional update', async () => {
    seedSlackSearchCredential()
    dbChainMockFns.returning.mockResolvedValueOnce([])
    expect(
      await rejectManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [],
        rejectedAccessToken: 'xoxp-slack-token',
      })
    ).toBe(false)
  })

  it('does not reject a token from a different provider', async () => {
    seedSlackSearchCredential()
    expect(
      await rejectManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'google-drive',
        requiredScopes: [],
        rejectedAccessToken: 'xoxp-slack-token',
      })
    ).toBe(false)
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it.each(
    (['workspace', 'organization'] as const).flatMap((owner) =>
      (['success', 'terminal', 'transient'] as const).map((outcome) => ({ owner, outcome }))
    )
  )(
    'uses canonical refresh for a rejected $owner access token: $outcome',
    async ({ owner, outcome }) => {
      const current = {
        ...mondayCredentialRow(),
        accessTokenExpiresAt: new Date('2026-09-01T13:00:00Z'),
      }
      const expired = { ...current, accessTokenExpiresAt: new Date(0) }
      dbChainMockFns.limit
        .mockResolvedValueOnce([current])
        .mockResolvedValueOnce([expired])
        .mockResolvedValueOnce([expired])
      dbChainMockFns.returning.mockResolvedValue([{ id: current.id }])
      mocks.decryptSecret.mockResolvedValue({
        decrypted: JSON.stringify({
          type: 'managed-oauth-token-set',
          version: 1,
          tokenType: 'Bearer',
          accessToken: 'rejected-token',
          refreshToken: 'refresh-token',
        }),
      })
      mocks.encryptSecret.mockResolvedValue({ encrypted: 'refreshed-token-envelope' })
      const refreshToken = vi.fn().mockResolvedValue(
        outcome === 'success'
          ? {
              ok: true,
              accessToken: 'fresh-token',
              refreshToken: 'fresh-refresh',
              expiresIn: 3600,
            }
          : {
              ok: false,
              errorCode: outcome === 'terminal' ? 'invalid_grant' : 'temporarily_unavailable',
            }
      )
      mocks.getAdapter.mockReturnValue({
        getPolicy: vi.fn().mockResolvedValue({
          authorizationAppId: current.authorizationAppId,
          scopeVersion: 1,
          requiredScopes: current.grantedScopes,
        }),
        hasRequiredScopes: vi.fn().mockReturnValue(true),
        refreshToken,
        isTerminalRefreshError: (code: string) => code === 'invalid_grant',
      })
      const rejection = rejectManagedOAuthToken({
        ...mondayTokenResolutionParams(),
        ...(owner === 'organization'
          ? { workspaceId: undefined, organizationId: 'organization-1' }
          : {}),
        rejectedAccessToken: 'rejected-token',
      })
      await expect(rejection).resolves.toBe(outcome === 'terminal')
      expect(refreshToken).toHaveBeenCalledWith('refresh-token')
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        accessTokenExpiresAt: new Date(0),
        updatedAt: expect.any(Date),
      })
      expect(
        dbChainMockFns.set.mock.calls.some(([value]) => value.managedOauthStatus === 'needs_reauth')
      ).toBe(outcome === 'terminal')
    }
  )

  it('does not let a Search grant execute a Slack write operation', async () => {
    seedSlackSearchCredential()
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: ['chat:write'],
      })
    ).rejects.toMatchObject({ code: 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  it('rejects previously accumulated workflow grants outside the current Search policy', async () => {
    seedSlackSearchCredential('option-1', 'active', SLACK_MANAGED_USER_SCOPES)
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: ['chat:write'],
      })
    ).rejects.toMatchObject({ code: 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  it('allows Search reads when Slack retains a broader grant', async () => {
    seedSlackSearchCredential('option-1', 'active', SLACK_MANAGED_USER_SCOPES)
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
      })
    ).resolves.toEqual({ accessToken: 'xoxp-slack-token', refreshed: false })
  })

  it('requires the actual grant to cover an operation allowed by the Search policy', async () => {
    seedSlackSearchCredential(
      'option-1',
      'active',
      SLACK_SEARCH_USER_SCOPES.filter((scope) => scope !== 'groups:history')
    )
    await expect(
      resolveManagedOAuthToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'slack',
        requiredScopes: ['groups:history'],
      })
    ).rejects.toMatchObject({ code: 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
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
        requiredScopes: row.grantedScopes,
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
        requiredScopes: row.grantedScopes,
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
