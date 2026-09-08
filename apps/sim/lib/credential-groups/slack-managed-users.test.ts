/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { attempts, redis } = vi.hoisted(() => {
  const attempts = new Map<string, string>()
  return {
    attempts,
    redis: {
      set: vi.fn(async (key: string, value: string) => {
        if (attempts.has(key)) return null
        attempts.set(key, value)
        return 'OK'
      }),
      get: vi.fn(async (key: string) => attempts.get(key) ?? null),
      eval: vi.fn(async (_script: string, _count: number, key: string) => {
        const value = attempts.get(key) ?? null
        attempts.delete(key)
        return value
      }),
    },
  }
})

vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redis }))
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${Buffer.from(value).toString('base64')}`,
  })),
  decryptSecret: vi.fn(async (value: string) => ({
    decrypted:
      value === 'encrypted-bot'
        ? JSON.stringify({
            type: 'slack_custom_bot',
            signingSecret: 'signing-secret',
            botToken: 'xoxb-token',
            teamId: 'T123',
          })
        : Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  })),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.ai' }))

import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  consumeSlackManagedUsersAttempt,
  createSlackManagedUsersAttempt,
  exchangeAndConfigureSlackManagedUsers,
  exchangeSlackUserAuthorization,
  loadSlackManagedUsersAttempt,
  verifySlackCustomBotAppIdentity,
  verifySlackUserIdentity,
} from '@/lib/credential-groups/slack-managed-users'

function slackResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Slack managed-user authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    attempts.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores exact organization ownership in the encrypted setup attempt and rejects ambiguous ownership', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'group-1', updatedAt: new Date(1), options: [] }])
      .mockResolvedValueOnce([
        { id: 'bot-1', updatedAt: new Date(2), encryptedServiceAccountKey: 'encrypted-bot' },
      ])
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          slackResponse({ ok: true, team_id: 'T123', user_id: 'U123', bot_id: 'B123' })
        )
        .mockResolvedValueOnce(slackResponse({ ok: true, bot: { app_id: 'A123' } }))
    )
    const created = await createSlackManagedUsersAttempt({
      organizationId: 'org-1',
      userId: 'user-1',
      credentialGroupId: 'group-1',
      appId: 'A123',
      teamId: 'T123',
      clientId: 'client-1',
      clientSecret: 'private-client-secret',
    })
    const loaded = await loadSlackManagedUsersAttempt(created.state)
    expect(loaded).toMatchObject({ organizationId: 'org-1', userId: 'user-1' })
    expect(loaded).not.toHaveProperty('workspaceId')
    expect(loaded).not.toHaveProperty('slackBotCredentialId')
    expect(fetch).not.toHaveBeenCalled()
    const [key, stored] = [...attempts.entries()][0]
    expect(stored).not.toContain('private-client-secret')
    attempts.set(key, JSON.stringify({ ...JSON.parse(stored), workspaceId: 'workspace-1' }))
    await expect(loadSlackManagedUsersAttempt(created.state)).rejects.toThrow('malformed')
  })

  it('binds the bot token to Slack app and workspace identities', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        slackResponse({ ok: true, team_id: 'T123', user_id: 'U123', bot_id: 'B123' })
      )
      .mockResolvedValueOnce(slackResponse({ ok: true, bot: { id: 'B123', app_id: 'A123' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifySlackCustomBotAppIdentity('xoxb-token')).resolves.toEqual({
      appId: 'A123',
      teamId: 'T123',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://slack.com/api/bots.info',
      expect.objectContaining({ body: new URLSearchParams({ bot: 'B123' }) })
    )
  })

  it.each([
    {
      name: 'new search',
      existingScopes: undefined,
      requestedScopes: undefined,
      scopes: SLACK_SEARCH_USER_SCOPES,
    },
    {
      name: 'existing workflow',
      existingScopes: SLACK_MANAGED_USER_SCOPES,
      requestedScopes: undefined,
      scopes: SLACK_MANAGED_USER_SCOPES,
    },
    {
      name: 'existing search',
      existingScopes: SLACK_SEARCH_USER_SCOPES,
      requestedScopes: undefined,
      scopes: SLACK_SEARCH_USER_SCOPES,
    },
    {
      name: 'explicit switch to search',
      existingScopes: SLACK_MANAGED_USER_SCOPES,
      requestedScopes: SLACK_SEARCH_USER_SCOPES,
      scopes: SLACK_SEARCH_USER_SCOPES,
    },
  ])(
    'binds $name scopes to encrypted one-time setup state',
    async ({ existingScopes, requestedScopes, scopes }) => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([
          {
            id: '22222222-2222-4222-8222-222222222222',
            updatedAt: new Date('2026-08-12T00:00:00Z'),
            options: existingScopes
              ? [{ provider: 'slack', requiredScopes: [...existingScopes] }]
              : [],
          },
        ])
        .mockResolvedValueOnce([
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Support bot',
            updatedAt: new Date('2026-08-12T00:00:00Z'),
            encryptedServiceAccountKey: 'encrypted-bot',
          },
        ])
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            slackResponse({ ok: true, team_id: 'T123', user_id: 'U123', bot_id: 'B123' })
          )
          .mockResolvedValueOnce(slackResponse({ ok: true, bot: { app_id: 'A123' } }))
      )

      const created = await createSlackManagedUsersAttempt({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        credentialGroupId: '22222222-2222-4222-8222-222222222222',
        slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        ...(requestedScopes ? { requiredScopes: [...requestedScopes] } : {}),
      })

      expect(created.authorizationUrl).toContain('team=T123')
      expect(created.authorizationUrl).toContain('user_scope=channels%3Ahistory')
      expect(new URL(created.authorizationUrl).searchParams.get('user_scope')?.split(',')).toEqual([
        ...scopes,
      ])
      expect([...attempts.values()][0]).not.toContain('client-secret')
      await expect(loadSlackManagedUsersAttempt(created.state)).resolves.toMatchObject({
        credentialGroupId: '22222222-2222-4222-8222-222222222222',
        slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        expectedAppId: 'A123',
        expectedTeamId: 'T123',
        clientSecret: 'client-secret',
        requiredScopes: [...scopes],
      })
      await expect(consumeSlackManagedUsersAttempt(created.state)).resolves.toMatchObject({
        clientId: 'client-id',
      })
      await expect(consumeSlackManagedUsersAttempt(created.state)).resolves.toBeNull()
    }
  )

  it('returns an actionable error when the custom bot lacks users:read', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(slackResponse({ ok: true, team_id: 'T123', bot_id: 'B123' }))
        .mockResolvedValueOnce(
          slackResponse({ ok: false, error: 'missing_scope', needed: 'users:read' })
        )
    )

    await expect(verifySlackCustomBotAppIdentity('xoxb-token')).rejects.toThrow(
      'Add the users:read bot scope'
    )
  })

  it.each([
    { name: 'search', scopes: SLACK_SEARCH_USER_SCOPES },
    { name: 'workflow', scopes: SLACK_MANAGED_USER_SCOPES },
  ])(
    'stores $name scopes and requires reauthorization when the policy changes',
    async ({ scopes }) => {
      const updatedAt = new Date('2026-08-12T00:00:00Z')
      queueTableRows(schemaMock.credentialGroup, [
        {
          id: '22222222-2222-4222-8222-222222222222',
          workspaceId: 'workspace-1',
          name: 'Support accounts',
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              label: 'Slack',
              status: 'active',
              required: true,
              authorizationAppId: 'slack:A123:T123',
              requiredScopes: [...SLACK_MANAGED_USER_SCOPES],
              scopeVersion: credentialGroupScopePolicyVersion([...SLACK_MANAGED_USER_SCOPES]),
            },
          ],
          encryptedProviderConfiguration: null,
          updatedAt,
        },
      ])
      queueTableRows(schemaMock.credential, [
        {
          id: '11111111-1111-4111-8111-111111111111',
          updatedAt,
          encryptedServiceAccountKey: 'encrypted-bot',
        },
      ])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: '11111111-1111-4111-8111-111111111111' }])
        .mockResolvedValueOnce([{ id: '22222222-2222-4222-8222-222222222222' }])
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          slackResponse({
            ok: true,
            app_id: 'A123',
            team: { id: 'T123', name: 'Sim' },
            authed_user: {
              id: 'U123',
              access_token: 'xoxp-token',
              token_type: 'user',
              scope: scopes.join(','),
            },
          })
        )
        .mockResolvedValueOnce(slackResponse({ ok: true, team_id: 'T123', user_id: 'U123' }))
        .mockResolvedValueOnce(
          slackResponse({
            ok: true,
            user: { id: 'U123', profile: { email: 'theo@sim.ai' } },
          })
        )
        .mockResolvedValueOnce(slackResponse({ ok: true, revoked: true }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        exchangeAndConfigureSlackManagedUsers({
          attempt: {
            workspaceId: 'workspace-1',
            userId: 'user-1',
            credentialGroupId: '22222222-2222-4222-8222-222222222222',
            credentialGroupUpdatedAt: updatedAt.getTime(),
            slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
            slackBotCredentialUpdatedAt: updatedAt.getTime(),
            expectedAppId: 'A123',
            expectedTeamId: 'T123',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            redirectUri: 'https://sim.ai/callback',
            requiredScopes: [...scopes],
            createdAt: Date.now(),
          },
          code: 'single-use-code',
        })
      ).resolves.toMatchObject({
        credentialGroupId: '22222222-2222-4222-8222-222222222222',
        slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
      })
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ authorizationAppId: null, managedOauthScopeVersion: null })
      )
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          encryptedProviderConfiguration: expect.any(String),
          options: [
            expect.objectContaining({
              provider: 'slack',
              slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
              requiredScopes: [...scopes],
              required: true,
            }),
          ],
        })
      )
      expect(JSON.stringify(dbChainMockFns.set.mock.calls[1])).not.toContain('client-secret')
      if (scopes === SLACK_SEARCH_USER_SCOPES) {
        expect(dbChainMockFns.set).toHaveBeenCalledWith(
          expect.objectContaining({ managedOauthStatus: 'needs_reauth' })
        )
      } else {
        expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
          expect.objectContaining({ managedOauthStatus: 'needs_reauth' })
        )
      }
    }
  )

  it('rejects a search grant missing one required permission and revokes the temporary token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          app_id: 'A123',
          team: { id: 'T123', name: 'Sim' },
          authed_user: {
            id: 'U123',
            access_token: 'xoxp-token',
            token_type: 'user',
            scope: SLACK_SEARCH_USER_SCOPES.filter((scope) => scope !== 'groups:history').join(','),
          },
        })
      )
      .mockResolvedValueOnce(slackResponse({ ok: true, revoked: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      exchangeAndConfigureSlackManagedUsers({
        attempt: {
          workspaceId: 'workspace-1',
          userId: 'user-1',
          credentialGroupId: 'group-1',
          credentialGroupUpdatedAt: 0,
          slackBotCredentialId: 'bot-1',
          slackBotCredentialUpdatedAt: 0,
          expectedAppId: 'A123',
          expectedTeamId: 'T123',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://sim.ai/callback',
          requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
          createdAt: Date.now(),
        },
        code: 'single-use-code',
      })
    ).rejects.toThrow('every permission')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://slack.com/api/auth.revoke',
      expect.anything()
    )
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('requires Slack to attest a user token, app, team, user, and scopes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      slackResponse({
        ok: true,
        app_id: 'A123',
        team: { id: 'T123', name: 'Sim' },
        authed_user: {
          id: 'U123',
          access_token: 'xoxp-token',
          token_type: 'user',
          scope: 'users:read,users:read.email',
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeSlackUserAuthorization({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'single-use-code',
      redirectUri: 'https://sim.ai/callback',
    })

    expect(result).toMatchObject({
      appId: 'A123',
      teamId: 'T123',
      userId: 'U123',
      accessToken: 'xoxp-token',
      tokenType: 'user',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/oauth.v2.access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
      })
    )
  })

  it('fails closed when Slack omits the user token type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        slackResponse({
          ok: true,
          app_id: 'A123',
          team: { id: 'T123', name: 'Sim' },
          authed_user: {
            id: 'U123',
            access_token: 'xoxp-token',
            scope: 'users:read',
          },
        })
      )
    )

    await expect(
      exchangeSlackUserAuthorization({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        code: 'single-use-code',
        redirectUri: 'https://sim.ai/callback',
      })
    ).rejects.toThrow('Slack returned an incomplete authorization')
  })

  it('revokes the setup token and stores nothing when client credentials target another app', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          app_id: 'A999',
          team: { id: 'T123', name: 'Sim' },
          authed_user: {
            id: 'U123',
            access_token: 'xoxp-token',
            token_type: 'user',
            scope: SLACK_MANAGED_USER_SCOPES.join(','),
          },
        })
      )
      .mockResolvedValueOnce(slackResponse({ ok: true, revoked: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      exchangeAndConfigureSlackManagedUsers({
        attempt: {
          workspaceId: 'workspace-1',
          userId: 'user-1',
          credentialGroupId: '22222222-2222-4222-8222-222222222222',
          credentialGroupUpdatedAt: new Date('2026-08-12T00:00:00Z').getTime(),
          slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
          slackBotCredentialUpdatedAt: new Date('2026-08-12T00:00:00Z').getTime(),
          expectedAppId: 'A123',
          expectedTeamId: 'T123',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://sim.ai/callback',
          requiredScopes: [...SLACK_MANAGED_USER_SCOPES],
          createdAt: Date.now(),
        },
        code: 'single-use-code',
      })
    ).rejects.toThrow('different app or workspace')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://slack.com/api/auth.revoke',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer xoxp-token' }),
      })
    )
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('verifies the token identity and reads cosmetic profile metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(slackResponse({ ok: true, team_id: 'T123', user_id: 'U123' }))
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          user: {
            id: 'U123',
            name: 'theo',
            profile: {
              email: 'theo@sim.ai',
              display_name: 'Theo',
              image_192: 'https://avatars.slack-edge.com/theo.png',
            },
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifySlackUserIdentity({
        accessToken: 'xoxp-token',
        expectedTeamId: 'T123',
        expectedUserId: 'U123',
      })
    ).resolves.toEqual({
      userId: 'U123',
      teamId: 'T123',
      email: 'theo@sim.ai',
      displayName: 'Theo',
      avatarUrl: 'https://avatars.slack-edge.com/theo.png',
      username: 'theo',
    })
  })
})
