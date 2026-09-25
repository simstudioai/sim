import type { CredentialGroupOptionConfig } from '@sim/db/schema'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  exchange: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@/lib/credential-groups/provider-configuration', () => ({
  getSlackCredentialGroupConfiguration: mocks.configuration,
}))
vi.mock('@/lib/credential-groups/slack-managed-users', () => ({
  getSlackCustomBotCredential: async () => ({ id: 'bot-1', teamId: 'T1' }),
  exchangeSlackUserAuthorization: mocks.exchange,
  revokeSlackToken: mocks.revoke,
  verifySlackUserIdentity: async () => ({
    userId: 'U1',
    teamId: 'T1',
    email: 'member@fixture.test',
  }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.fixture.test' }))

import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { slackCredentialGroupProviderAdapter as adapter } from '@/lib/credential-groups/slack-provider'

describe('Slack member scope policy', () => {
  beforeEach(() => {
    resetEnvFlagsMock()
    mocks.configuration.mockResolvedValue({
      slackBotCredentialId: 'bot-1',
      clientId: 'client',
      clientSecret: 'secret',
      appId: 'A1',
      teamId: 'T1',
      scopes: [...SLACK_MANAGED_USER_SCOPES],
    })
    mocks.exchange.mockResolvedValue({
      appId: 'A1',
      teamId: 'T1',
      teamName: 'Fixture',
      userId: 'U1',
      accessToken: 'fixture-token',
      tokenType: 'user',
      scopes: [...SLACK_SEARCH_USER_SCOPES],
    })
  })

  function context(scopes: readonly string[]): CredentialGroupOAuthContext {
    const option: CredentialGroupOptionConfig = {
      id: 'option-1',
      provider: 'slack',
      label: 'Slack',
      slackBotCredentialId: 'bot-1',
      requiredScopes: [...scopes],
      scopeVersion: 1,
      authorizationAppId: 'slack:A1:T1',
      required: false,
      status: 'active',
    }
    return {
      enrollmentId: 'enrollment',
      credentialGroupId: 'group-1',
      credentialGroupName: 'Fixture',
      workspaceId: 'workspace-1',
      workspaceName: 'Fixture',
      workspaceOwnerId: 'owner',
      email: 'sim-member@fixture.test',
      enrollmentStatus: 'in_progress',
      option,
      options: [option],
    }
  }

  it('requests RTS consent only with live search enabled while retaining the stored policy', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    const current = context(SLACK_SEARCH_USER_SCOPES)
    const policy = await adapter.getPolicy(current.option, {
      workspaceId: current.workspaceId,
      credentialGroupId: current.credentialGroupId,
    })
    const authorization = await adapter.prepareAuthorization(current, policy)
    const url = new URL(
      await authorization.buildAuthorizationUrl({ state: 'state', nonce: 'nonce' })
    )
    expect(url.searchParams.get('user_scope')?.split(',')).toEqual(
      expect.arrayContaining([
        'search:read.public',
        'search:read.private',
        'search:read.im',
        'search:read.mpim',
        'search:read.files',
        'files:read',
      ])
    )
    expect(policy.requiredScopes).toEqual([...SLACK_SEARCH_USER_SCOPES])
  })

  it('uses the option policy for enrollment instead of widening it', async () => {
    const scopes = SLACK_MANAGED_USER_SCOPES
    const current = context(scopes)
    const policy = await adapter.getPolicy(current.option, {
      workspaceId: current.workspaceId,
      credentialGroupId: current.credentialGroupId,
    })
    expect(policy.requiredScopes).toEqual([...scopes])
    const authorization = await adapter.prepareAuthorization(current, policy)
    const url = new URL(
      await authorization.buildAuthorizationUrl({ state: 'state', nonce: 'nonce' })
    )
    expect(url.searchParams.get('user_scope')?.split(',')).toEqual([...scopes])
  })

  it('accepts a different provider email', async () => {
    const scopes = SLACK_SEARCH_USER_SCOPES
    const current = context(scopes)
    mocks.exchange.mockResolvedValueOnce({
      appId: 'A1',
      teamId: 'T1',
      userId: 'U1',
      accessToken: 'fixture-token',
      tokenType: 'user',
      scopes: [...scopes],
    })
    const policy = await adapter.getPolicy(current.option, {
      workspaceId: current.workspaceId,
      credentialGroupId: current.credentialGroupId,
    })
    const result = adapter.exchangeAndVerify({
      context: current,
      policy,
      code: 'code',
      attempt: {
        state: 'state',
        provider: 'slack',
        workspaceId: 'workspace-1',
        email: current.email,
        nonceHash: 'nonce-hash',
        enrollmentId: current.enrollmentId,
        credentialGroupId: current.credentialGroupId,
        optionId: current.option.id,
        authorizationAppId: policy.authorizationAppId,
        scopeVersion: policy.scopeVersion,
        requiredScopes: policy.requiredScopes,
        redirectUri: 'https://sim.fixture.test/api/credential-groups/oauth/slack/callback',
        invitationToken: 'invitation',
        createdAt: Date.now(),
      },
    })
    await expect(result).resolves.toMatchObject({
      providerSubjectId: 'U1',
      providerTenantId: 'T1',
      displayName: 'member@fixture.test',
      metadata: { email: 'member@fixture.test' },
      grantedScopes: [...scopes],
    })
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing permissions', grant: { scopes: [...SLACK_SEARCH_USER_SCOPES] } },
    { name: 'a different team', grant: { teamId: 'T2' } },
    { name: 'a different app', grant: { appId: 'A2' } },
  ])('still rejects $name and revokes the grant', async ({ grant }) => {
    const current = context(SLACK_MANAGED_USER_SCOPES)
    const policy = await adapter.getPolicy(current.option, {
      workspaceId: current.workspaceId,
      credentialGroupId: current.credentialGroupId,
    })
    mocks.exchange.mockResolvedValueOnce({
      appId: 'A1',
      teamId: 'T1',
      userId: 'U1',
      accessToken: 'fixture-token',
      tokenType: 'user',
      scopes: [...SLACK_MANAGED_USER_SCOPES],
      ...grant,
    })
    await expect(
      adapter.exchangeAndVerify({
        context: current,
        policy,
        code: 'code',
        attempt: {
          state: 'state',
          provider: 'slack',
          workspaceId: current.workspaceId,
          email: current.email,
          nonceHash: 'nonce-hash',
          enrollmentId: current.enrollmentId,
          credentialGroupId: current.credentialGroupId,
          optionId: current.option.id,
          authorizationAppId: policy.authorizationAppId,
          scopeVersion: policy.scopeVersion,
          requiredScopes: policy.requiredScopes,
          redirectUri: 'https://sim.fixture.test/api/credential-groups/oauth/slack/callback',
          invitationToken: 'invitation',
          createdAt: Date.now(),
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith('fixture-token')
  })

  it('requires reconfiguration when the configured app lacks a scope in the option', async () => {
    mocks.configuration.mockResolvedValue({
      slackBotCredentialId: 'bot-1',
      clientId: 'client',
      clientSecret: 'secret',
      appId: 'A1',
      teamId: 'T1',
      scopes: SLACK_SEARCH_USER_SCOPES.filter((scope) => scope !== 'groups:history'),
    })
    await expect(
      adapter.getPolicy(context(SLACK_SEARCH_USER_SCOPES).option, {
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
      })
    ).rejects.toThrow('Reconfigure Slack')
  })
})
