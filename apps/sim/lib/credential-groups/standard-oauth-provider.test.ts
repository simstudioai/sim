/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'

const { mockGetToken, mockVerifyIdentity } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockVerifyIdentity: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.example.com',
}))

vi.mock('@/lib/auth/connectors/managed-oauth', () => ({
  getManagedOAuthConnectorProviderConfig: (providerId: string) => {
    if (providerId === 'google-calendar') {
      return {
        providerId,
        clientId: 'client-1',
        clientSecret: 'secret-1',
        authorizationUrl: 'https://accounts.example.com/authorize',
        tokenUrl: 'https://accounts.example.com/token',
        redirectURI: 'https://sim.example.com/api/auth/oauth2/callback/google-calendar',
        accessType: 'offline',
        scopes: ['calendar.read', 'profile'],
        getToken: mockGetToken,
        managedOAuth: {
          additionalScopes: ['openid'],
          requiresRefreshToken: true,
          pkce: true,
          nonceVerification: 'id_token',
          includeLoginHint: true,
          prompt: 'consent select_account',
          authorizationUrlParams: { include_granted_scopes: 'false' },
          getAuthorizationAppId: (clientId: string) => `google:${clientId}`,
          verifyIdentity: mockVerifyIdentity,
          hasRequiredScopes: (granted: string[], required: string[]) =>
            required.every((scope) => granted.includes(scope)),
          isTerminalRefreshError: (errorCode: string | undefined) => errorCode === 'invalid_grant',
        },
      }
    }
    if (providerId === 'jira') {
      return {
        providerId,
        clientId: 'jira-client-1',
        clientSecret: 'jira-secret-1',
        authorizationUrl: 'https://auth.atlassian.com/authorize',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        redirectURI: 'https://sim.example.com/api/auth/oauth2/callback/jira',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        responseType: 'code',
        authentication: 'basic',
        prompt: 'consent',
        authorizationUrlParams: { audience: 'api.atlassian.com' },
        getToken: mockGetToken,
        managedOAuth: {
          additionalScopes: [],
          requiresRefreshToken: true,
          pkce: false,
          nonceVerification: 'state_only',
          includeLoginHint: false,
          prompt: 'consent',
          authorizationUrlParams: { audience: 'api.atlassian.com' },
          getAuthorizationAppId: (clientId: string) => `jira:${clientId}`,
          verifyIdentity: mockVerifyIdentity,
          hasRequiredScopes: (granted: string[], required: string[]) =>
            required.every((scope) => granted.includes(scope)),
          isTerminalRefreshError: (errorCode: string | undefined) => errorCode === 'invalid_grant',
        },
      }
    }
    return undefined
  },
}))

import { createStandardOAuthCredentialGroupProviderAdapter } from '@/lib/credential-groups/standard-oauth-provider'

const adapter = createStandardOAuthCredentialGroupProviderAdapter('google-calendar')
const jiraAdapter = createStandardOAuthCredentialGroupProviderAdapter('jira')

function buildContext(): CredentialGroupOAuthContext {
  return {
    enrollmentId: 'enrollment-1',
    credentialGroupId: 'group-1',
    credentialGroupName: 'Credential Group',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    workspaceOwnerId: 'owner-1',
    email: 'person@example.com',
    enrollmentStatus: 'in_progress',
    option: {
      id: 'option-1',
      provider: 'google-calendar',
      label: 'Google Calendar',
      authorizationAppId: 'google:client-1',
      requiredScopes: ['calendar.read', 'profile', 'openid'],
      scopeVersion: 1,
      required: true,
      status: 'active',
    },
    options: [],
  }
}

function buildAttempt(scopeVersion: number): CredentialGroupOAuthAttempt {
  return {
    workspaceId: 'workspace-1',
    email: 'person@example.com',
    state: 'state-1',
    provider: 'google-calendar',
    nonceHash: createHash('sha256').update('nonce-1').digest('hex'),
    enrollmentId: 'enrollment-1',
    credentialGroupId: 'group-1',
    optionId: 'option-1',
    authorizationAppId: 'google:client-1',
    scopeVersion,
    requiredScopes: ['calendar.read', 'profile', 'openid'],
    redirectUri: 'https://sim.example.com/api/auth/oauth2/callback/google-calendar',
    codeVerifier: 'verifier-1',
    invitationToken: 'invitation-1',
    createdAt: Date.now(),
  }
}

describe('standard OAuth Credential Group provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetToken.mockResolvedValue({
      tokenType: 'Bearer',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: new Date('2026-08-14T01:00:00Z'),
    })
    mockVerifyIdentity.mockResolvedValue({
      providerSubjectId: 'google-sub-1',
      providerTenantId: 'example.com',
      email: 'person@example.com',
      emailVerified: true,
      displayName: 'Person',
      avatarUrl: 'https://example.com/avatar.png',
      nonce: 'nonce-1',
      grantedScopes: ['calendar.read', 'profile', 'openid'],
    })
  })

  it('builds authorization from the existing connector configuration', async () => {
    const context = buildContext()
    const policy = await adapter.getPolicy(context.option, {
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
    })
    const prepared = await adapter.prepareAuthorization(context, policy)
    const authorizationUrl = new URL(
      await prepared.buildAuthorizationUrl({ state: 'state-1', nonce: 'nonce-1' })
    )

    expect(policy).toMatchObject({
      provider: 'google-calendar',
      providerId: 'google-calendar',
      authorizationAppId: 'google:client-1',
      requiredScopes: ['calendar.read', 'profile', 'openid'],
    })
    expect(prepared.codeVerifier).toHaveLength(86)
    expect(prepared.redirectUri).toBe(
      'https://sim.example.com/api/auth/oauth2/callback/google-calendar'
    )
    expect(authorizationUrl.origin).toBe('https://accounts.example.com')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client-1')
    expect(authorizationUrl.searchParams.get('state')).toBe('state-1')
    expect(authorizationUrl.searchParams.get('nonce')).toBe('nonce-1')
    expect(authorizationUrl.searchParams.get('login_hint')).toBe('person@example.com')
    expect(authorizationUrl.searchParams.get('include_granted_scopes')).toBe('false')
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('persists a verified provider identity and returned scopes', async () => {
    const context = buildContext()
    const policy = await adapter.getPolicy(context.option, {
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
    })
    const grant = await adapter.exchangeAndVerify({
      context,
      attempt: buildAttempt(policy.scopeVersion),
      code: 'code-1',
      policy,
    })

    expect(mockGetToken).toHaveBeenCalledWith({
      code: 'code-1',
      redirectURI: 'https://sim.example.com/api/auth/oauth2/callback/google-calendar',
      codeVerifier: 'verifier-1',
    })
    expect(grant).toMatchObject({
      providerId: 'google-calendar',
      providerSubjectId: 'google-sub-1',
      providerTenantId: 'example.com',
      displayName: 'person@example.com',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      grantedScopes: ['calendar.read', 'profile', 'openid'],
      metadata: {
        email: 'person@example.com',
        displayName: 'Person',
        avatarUrl: 'https://example.com/avatar.png',
      },
    })
  })

  it('rejects a different invited email', async () => {
    mockVerifyIdentity.mockResolvedValueOnce({
      providerSubjectId: 'google-sub-2',
      providerTenantId: null,
      email: 'other@example.com',
      emailVerified: true,
      nonce: 'nonce-1',
      grantedScopes: ['calendar.read', 'profile', 'openid'],
    })
    const context = buildContext()
    const policy = await adapter.getPolicy(context.option, {
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
    })

    await expect(
      adapter.exchangeAndVerify({
        context,
        attempt: buildAttempt(policy.scopeVersion),
        code: 'code-1',
        policy,
      })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('uses the existing Atlassian callback and state-bound identity verification', async () => {
    const requiredScopes = ['read:me', 'read:jira-work', 'offline_access']
    const context: CredentialGroupOAuthContext = {
      ...buildContext(),
      option: {
        ...buildContext().option,
        provider: 'jira',
        label: 'Jira',
        authorizationAppId: 'jira:jira-client-1',
        requiredScopes,
      },
    }
    const policy = await jiraAdapter.getPolicy(context.option, {
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
    })
    const prepared = await jiraAdapter.prepareAuthorization(context, policy)
    const authorizationUrl = new URL(
      await prepared.buildAuthorizationUrl({ state: 'cg_state-1', nonce: 'nonce-ignored' })
    )

    expect(prepared.redirectUri).toBe('https://sim.example.com/api/auth/oauth2/callback/jira')
    expect(prepared.codeVerifier).toBeUndefined()
    expect(authorizationUrl.searchParams.get('audience')).toBe('api.atlassian.com')
    expect(authorizationUrl.searchParams.has('nonce')).toBe(false)
    expect(authorizationUrl.searchParams.has('login_hint')).toBe(false)
    expect(authorizationUrl.searchParams.has('code_challenge')).toBe(false)

    mockVerifyIdentity.mockResolvedValueOnce({
      providerSubjectId: 'atlassian-account-1',
      providerTenantId: null,
      email: 'person@example.com',
      emailVerified: true,
      grantedScopes: requiredScopes,
    })
    const grant = await jiraAdapter.exchangeAndVerify({
      context,
      attempt: {
        state: 'cg_state-1',
        provider: 'jira',
        nonceHash: 'unused-for-state-bound-provider',
        enrollmentId: context.enrollmentId,
        credentialGroupId: context.credentialGroupId,
        optionId: context.option.id,
        authorizationAppId: policy.authorizationAppId,
        scopeVersion: policy.scopeVersion,
        requiredScopes,
        redirectUri: prepared.redirectUri,
        invitationToken: 'invitation-1',
        createdAt: Date.now(),
      },
      code: 'code-1',
      policy,
    })

    expect(grant.providerSubjectId).toBe('atlassian-account-1')
    expect(mockGetToken).toHaveBeenLastCalledWith({
      code: 'code-1',
      redirectURI: 'https://sim.example.com/api/auth/oauth2/callback/jira',
      codeVerifier: undefined,
    })
  })
  it.each(['bearer', 'BEARER'])(
    'accepts the RFC 6749 case-insensitive %s token type',
    async (tokenType) => {
      mockGetToken.mockResolvedValueOnce({
        tokenType,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        accessTokenExpiresAt: new Date('2026-08-14T01:00:00Z'),
      })
      const context = buildContext()
      const policy = await adapter.getPolicy(context.option, {
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
      })

      const grant = await adapter.exchangeAndVerify({
        context,
        attempt: buildAttempt(policy.scopeVersion),
        code: 'code-1',
        policy,
      })

      expect(grant.accessToken).toBe('access-1')
    }
  )

  it('still rejects a token type that is not bearer at all', async () => {
    mockGetToken.mockResolvedValueOnce({
      tokenType: 'mac',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    })
    const context = buildContext()
    const policy = await adapter.getPolicy(context.option, {
      workspaceId: context.workspaceId,
      credentialGroupId: context.credentialGroupId,
    })

    await expect(
      adapter.exchangeAndVerify({
        context,
        attempt: buildAttempt(policy.scopeVersion),
        code: 'code-1',
        policy,
      })
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})
