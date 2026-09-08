/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { adapter, createAttempt } = vi.hoisted(() => ({
  createAttempt: vi.fn(),
  adapter: {
    provider: 'gmail' as const,
    requiresRefreshToken: true,
    getPolicy: vi.fn(),
    prepareAuthorization: vi.fn(),
    exchangeAndVerify: vi.fn(),
    hasRequiredScopes: vi.fn(),
    refreshToken: vi.fn(),
    isTerminalRefreshError: vi.fn(),
  },
}))

vi.mock('@/lib/credential-groups/oauth-state', () => ({
  createCredentialGroupOAuthAttempt: createAttempt,
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => adapter,
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  decryptManagedOAuthTokenSet: vi.fn(),
  encryptManagedOAuthTokenSet: vi.fn().mockResolvedValue('encrypted-token-set'),
}))

vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  dispatchMemberSyncsForCredentialOption: vi.fn().mockResolvedValue(undefined),
}))

import {
  completeCredentialGroupOAuth,
  startCredentialGroupOAuth,
} from '@/lib/credential-groups/oauth'
import { CredentialGroupInvitationUnavailableError } from '@/lib/credential-groups/provider-adapter'
import { dispatchMemberSyncsForCredentialOption } from '@/lib/knowledge/connectors/member-queue'

const POLICY = {
  provider: 'gmail' as const,
  providerId: 'google-email',
  authorizationAppId: 'google:client',
  requiredScopes: ['openid', 'https://www.googleapis.com/auth/gmail.modify'],
  scopeVersion: 1,
}

const CONTEXT = {
  enrollmentId: 'enrollment-1',
  credentialGroupId: 'group-1',
  credentialGroupName: 'Credential Group',
  workspaceId: 'workspace-1',
  workspaceName: 'Workspace',
  workspaceOwnerId: 'owner-1',
  credentialOwnerId: 'person-1',
  email: 'person@example.com',
  enrollmentStatus: 'in_progress' as const,
  option: {
    id: 'option-1',
    provider: 'gmail' as const,
    label: 'Gmail',
    required: true,
    status: 'active' as const,
  },
  options: [],
}

const GROUP = {
  status: 'active' as const,
  options: [
    {
      ...CONTEXT.option,
      authorizationAppId: POLICY.authorizationAppId,
      requiredScopes: POLICY.requiredScopes,
      scopeVersion: POLICY.scopeVersion,
    },
  ],
}

describe('credential group OAuth persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    adapter.getPolicy.mockResolvedValue(POLICY)
    adapter.exchangeAndVerify.mockResolvedValue({
      providerId: POLICY.providerId,
      providerSubjectId: 'google-subject-1',
      providerTenantId: null,
      displayName: 'person@example.com',
      metadata: { email: 'person@example.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      grantedScopes: POLICY.requiredScopes,
      accessTokenExpiresAt: new Date('2026-08-14T00:00:00Z'),
      refreshTokenExpiresAt: null,
    })
  })

  it('pins Search return context with the same canonical option, identity and provider policy', async () => {
    const buildAuthorizationUrl = vi.fn().mockReturnValue('https://provider.test/authorize')
    adapter.prepareAuthorization.mockResolvedValue({
      redirectUri: 'https://sim.ai/callback',
      buildAuthorizationUrl,
    })
    createAttempt.mockResolvedValue({ state: 'state', nonce: 'nonce' })
    await expect(
      startCredentialGroupOAuth(CONTEXT, 'invitation', { returnTo: 'search' })
    ).resolves.toBe('https://provider.test/authorize')
    expect(createAttempt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: CONTEXT.workspaceId,
        enrollmentId: CONTEXT.enrollmentId,
        email: CONTEXT.email,
        optionId: CONTEXT.option.id,
        authorizationAppId: POLICY.authorizationAppId,
        scopeVersion: POLICY.scopeVersion,
        requiredScopes: POLICY.requiredScopes,
        returnTo: 'search',
        invitationToken: 'invitation',
      })
    )
    expect(buildAuthorizationUrl).toHaveBeenCalledExactlyOnceWith({
      state: 'state',
      nonce: 'nonce',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not reactivate a credential after its enrollment is revoked', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ status: 'revoked' }])

    await expect(
      completeCredentialGroupOAuth(
        CONTEXT,
        {
          state: 'state-1',
          userId: 'person-1',
          provider: 'gmail',
          nonceHash: 'nonce-hash',
          workspaceId: CONTEXT.workspaceId,
          email: CONTEXT.email,
          enrollmentId: CONTEXT.enrollmentId,
          credentialGroupId: CONTEXT.credentialGroupId,
          optionId: CONTEXT.option.id,
          authorizationAppId: POLICY.authorizationAppId,
          scopeVersion: POLICY.scopeVersion,
          requiredScopes: POLICY.requiredScopes,
          redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
          codeVerifier: 'verifier',
          invitationToken: 'invitation-token',
          createdAt: Date.now(),
        },
        'authorization-code'
      )
    ).rejects.toBeInstanceOf(CredentialGroupInvitationUnavailableError)

    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('returns a created event result after inserting a first credential', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ status: 'invited' }])
    queueTableRows(schemaMock.credentialGroup, [GROUP])
    queueTableRows(schemaMock.credential, [])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'credential-1' }])
      .mockResolvedValueOnce([{ id: CONTEXT.enrollmentId }])

    const result = await completeCredentialGroupOAuth(
      CONTEXT,
      {
        state: 'state-1',
        userId: 'person-1',
        provider: 'gmail',
        nonceHash: 'nonce-hash',
        workspaceId: CONTEXT.workspaceId,
        email: CONTEXT.email,
        enrollmentId: CONTEXT.enrollmentId,
        credentialGroupId: CONTEXT.credentialGroupId,
        optionId: CONTEXT.option.id,
        authorizationAppId: POLICY.authorizationAppId,
        scopeVersion: POLICY.scopeVersion,
        requiredScopes: POLICY.requiredScopes,
        redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
        codeVerifier: 'verifier',
        invitationToken: 'invitation-token',
        createdAt: Date.now(),
      },
      'authorization-code'
    )

    expect(result).toEqual({
      created: true,
      credentialId: 'credential-1',
      credentialGroupOptionId: 'option-1',
      provider: 'gmail',
      providerId: 'google-email',
      displayName: 'person@example.com',
      enrollmentStatus: 'in_progress',
    })
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.credential)
  })

  it.each([true, false])(
    'accepts the bound person without requiring organization membership (member=%s)',
    async (currentMember) => {
      const context = {
        ...CONTEXT,
        workspaceId: undefined,
        workspaceOwnerId: null,
        organizationId: 'org-1',
        credentialOwnerId: 'person-1',
      }
      const attempt = {
        state: 'state-1',
        userId: 'person-1',
        provider: 'gmail' as const,
        nonceHash: 'nonce',
        organizationId: 'org-1',
        email: CONTEXT.email,
        enrollmentId: CONTEXT.enrollmentId,
        credentialGroupId: CONTEXT.credentialGroupId,
        optionId: CONTEXT.option.id,
        authorizationAppId: POLICY.authorizationAppId,
        scopeVersion: POLICY.scopeVersion,
        requiredScopes: POLICY.requiredScopes,
        redirectUri: 'https://sim.ai/callback',
        codeVerifier: 'verifier',
        invitationToken: 'invitation',
        createdAt: Date.now(),
      }
      queueTableRows(schemaMock.member, currentMember ? [{ id: 'member-1' }] : [])
      queueTableRows(schemaMock.credentialGroupEnrollment, [{ status: 'invited' }])
      queueTableRows(schemaMock.credentialGroup, [GROUP])
      queueTableRows(schemaMock.credential, [])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 'credential-1' }])
        .mockResolvedValueOnce([{ id: CONTEXT.enrollmentId }])
      await expect(
        completeCredentialGroupOAuth(context, attempt, 'authorization-code')
      ).resolves.toMatchObject({ credentialId: 'credential-1', created: true })
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          workspaceId: null,
          createdBy: 'person-1',
        })
      )
      expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'person-1')
      expect(dispatchMemberSyncsForCredentialOption).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialGroupOptionId: 'option-1',
      })
      expect(eq).toHaveBeenCalledWith(
        schemaMock.credentialGroupEnrollment.invitationTokenHash,
        expect.any(String)
      )
    }
  )

  it('preserves completed enrollment state when an account reconnects', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ status: 'completed' }])
    queueTableRows(schemaMock.credentialGroup, [GROUP])
    queueTableRows(schemaMock.credential, [
      {
        id: 'credential-1',
        providerSubjectId: 'google-subject-1',
        encryptedOauthTokenSet: null,
        refreshTokenExpiresAt: null,
      },
    ])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'credential-1' }])
      .mockResolvedValueOnce([{ id: CONTEXT.enrollmentId }])

    const result = await completeCredentialGroupOAuth(
      { ...CONTEXT, enrollmentStatus: 'completed' },
      {
        state: 'state-1',
        userId: 'person-1',
        provider: 'gmail',
        nonceHash: 'nonce-hash',
        workspaceId: CONTEXT.workspaceId,
        email: CONTEXT.email,
        enrollmentId: CONTEXT.enrollmentId,
        credentialGroupId: CONTEXT.credentialGroupId,
        optionId: CONTEXT.option.id,
        authorizationAppId: POLICY.authorizationAppId,
        scopeVersion: POLICY.scopeVersion,
        requiredScopes: POLICY.requiredScopes,
        redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
        codeVerifier: 'verifier',
        invitationToken: 'invitation-token',
        createdAt: Date.now(),
      },
      'authorization-code'
    )

    const enrollmentUpdate = dbChainMockFns.set.mock.calls[1]?.[0]
    expect(enrollmentUpdate).toEqual(
      expect.objectContaining({ status: 'completed', updatedAt: expect.any(Date) })
    )
    expect(enrollmentUpdate).not.toHaveProperty('completedAt')
    expect(result).toEqual({
      created: false,
      credentialId: 'credential-1',
      credentialGroupOptionId: 'option-1',
      provider: 'gmail',
      providerId: 'google-email',
      displayName: 'person@example.com',
      enrollmentStatus: 'completed',
    })
  })

  it('rejects an exchanged grant when the group policy changed before persistence', async () => {
    const nextPolicy = {
      ...POLICY,
      requiredScopes: [...POLICY.requiredScopes, 'https://www.googleapis.com/auth/gmail.readonly'],
      scopeVersion: 2,
    }
    adapter.getPolicy.mockResolvedValueOnce(POLICY).mockResolvedValueOnce(nextPolicy)
    dbChainMockFns.limit.mockResolvedValueOnce([{ status: 'completed' }])
    queueTableRows(schemaMock.credentialGroup, [
      {
        ...GROUP,
        options: [
          {
            ...GROUP.options[0],
            requiredScopes: nextPolicy.requiredScopes,
            scopeVersion: nextPolicy.scopeVersion,
          },
        ],
      },
    ])

    await expect(
      completeCredentialGroupOAuth(
        { ...CONTEXT, enrollmentStatus: 'completed' },
        {
          state: 'state-1',
          userId: 'person-1',
          provider: 'gmail',
          nonceHash: 'nonce-hash',
          workspaceId: CONTEXT.workspaceId,
          email: CONTEXT.email,
          enrollmentId: CONTEXT.enrollmentId,
          credentialGroupId: CONTEXT.credentialGroupId,
          optionId: CONTEXT.option.id,
          authorizationAppId: POLICY.authorizationAppId,
          scopeVersion: POLICY.scopeVersion,
          requiredScopes: POLICY.requiredScopes,
          redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
          codeVerifier: 'verifier',
          invitationToken: 'invitation-token',
          createdAt: Date.now(),
        },
        'authorization-code'
      )
    ).rejects.toThrow('This credential option changed.')

    expect(adapter.getPolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'option-1' }),
      {
        workspaceId: CONTEXT.workspaceId,
        credentialGroupId: CONTEXT.credentialGroupId,
        executor: dbChainMock.db,
      }
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('refuses a retained revocation timestamp and locks the original email/group identity', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ status: 'in_progress', revokedAt: new Date() }])
    await expect(
      completeCredentialGroupOAuth(
        CONTEXT,
        {
          state: 'state',
          userId: 'person-1',
          provider: 'gmail',
          workspaceId: CONTEXT.workspaceId,
          email: CONTEXT.email,
          nonceHash: 'nonce',
          enrollmentId: CONTEXT.enrollmentId,
          credentialGroupId: CONTEXT.credentialGroupId,
          optionId: CONTEXT.option.id,
          authorizationAppId: POLICY.authorizationAppId,
          scopeVersion: POLICY.scopeVersion,
          requiredScopes: POLICY.requiredScopes,
          redirectUri: 'https://sim.ai/callback',
          invitationToken: 'invitation',
          createdAt: Date.now(),
        },
        'code'
      )
    ).rejects.toBeInstanceOf(CredentialGroupInvitationUnavailableError)
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.credentialGroupId,
      CONTEXT.credentialGroupId
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, CONTEXT.email)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
