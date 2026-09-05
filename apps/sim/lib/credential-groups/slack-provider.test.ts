/** @vitest-environment node */
import type { CredentialGroupOptionConfig } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ configuration: vi.fn(), exchange: vi.fn(), revoke: vi.fn() }))
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
    vi.clearAllMocks()
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
      email: 'member@fixture.test',
      enrollmentStatus: 'in_progress',
      option,
      options: [option],
    }
  }

  it.each([
    { name: 'search', scopes: SLACK_SEARCH_USER_SCOPES },
    { name: 'workflow', scopes: SLACK_MANAGED_USER_SCOPES },
  ])('uses the $name option policy for enrollment instead of widening it', async ({ scopes }) => {
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

  it('accepts a minimal search grant and rejects the same grant for a workflow option', async () => {
    for (const scopes of [SLACK_SEARCH_USER_SCOPES, SLACK_MANAGED_USER_SCOPES]) {
      const current = context(scopes)
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
          email: 'person@example.com',
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
      if (scopes === SLACK_SEARCH_USER_SCOPES)
        await expect(result).resolves.toMatchObject({
          grantedScopes: [...SLACK_SEARCH_USER_SCOPES],
        })
      else await expect(result).rejects.toThrow('All requested Slack permissions')
    }
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
