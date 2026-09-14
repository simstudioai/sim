/** @vitest-environment node */
import { db } from '@sim/db'
import { credential, slackSearchInstallation } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  consume: vi.fn(),
  store: vi.fn(),
  exchange: vi.fn(),
  verify: vi.fn(),
  membership: vi.fn(),
  rows: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  audit: vi.fn(),
  baseUrl: vi.fn(),
  shared: vi.fn(),
  revoke: vi.fn(),
  validateGrant: vi.fn(),
  ensureGroup: vi.fn(),
  memberApps: vi.fn(),
  adoptMemberApp: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/slack-search/shared-app', () => ({ readSharedSlackSearchApp: m.shared }))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: m.audit,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: m.baseUrl,
  SITE_URL: 'https://sim.test',
}))
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: async (value: string) => ({ encrypted: `encrypted:${value}` }),
  decryptSecret: async () => ({ decrypted: 'client-secret' }),
}))
vi.mock('@/lib/slack-search/oauth-state', () => ({
  consumeSlackSearchOAuthAttempt: m.consume,
  storeSlackSearchOAuthAttempt: m.store,
}))
vi.mock('@/lib/internal/slack/oauth', () => ({
  exchangeSlackBotAuthorization: m.exchange,
  revokeSlackBotAuthorization: m.revoke,
  validateSlackBotAuthorization: m.validateGrant,
}))
vi.mock('@/lib/credential-groups/service', () => ({ ensureWorkspaceAccountsGroup: m.ensureGroup }))
vi.mock('@/lib/credential-groups/organization-slack-app', () => ({
  loadOrganizationSlackMemberApps: m.memberApps,
  adoptOrganizationSlackMemberApp: m.adoptMemberApp,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({
  verifySlackSearchBot: m.verify,
  SlackSearchConfigurationError: class extends Error {},
  SlackSearchProviderError: class extends Error {},
}))

import {
  completeSlackSearchSetup,
  prepareSlackSearchSetup,
  startSlackSearchSetup,
} from '@/lib/knowledge/application/slack-search/setup'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const attempt = {
  userId: 'admin',
  sessionId: 'session',
  organizationId: 'org1',
  name: 'Sim Search',
  description: 'Search with sources',
  clientId: 'client',
  encryptedClientSecret: 'encrypted-client',
  encryptedSigningSecret: 'encrypted-signing',
  redirectUri: 'https://sim.test/api/knowledge/slack/oauth/callback',
  createdAt: Date.now(),
}
const identity = {
  appId: 'A1',
  teamId: 'T1',
  botUserId: 'UBOT',
  teamName: 'Test',
  enterpriseId: null,
}
const complete = () =>
  completeSlackSearchSetup.execute({ principal, input: { state: 'state', code: 'code' } })
beforeEach(() => {
  vi.clearAllMocks()
  m.shared.mockResolvedValue(null)
  m.revoke.mockResolvedValue(undefined)
  m.validateGrant.mockReset()
  m.ensureGroup.mockResolvedValue({ id: 'accounts' })
  m.memberApps.mockReset().mockResolvedValue([])
  m.baseUrl.mockReturnValue('https://sim.test')
  m.membership.mockResolvedValue([{ role: 'admin' }])
  m.rows.mockReset().mockResolvedValue([])
  m.consume.mockResolvedValue(attempt)
  m.store.mockResolvedValue('state')
  m.exchange.mockResolvedValue({
    app_id: 'A1',
    team: { id: 'T1' },
    bot_user_id: 'UBOT',
    access_token: 'bot-token',
  })
  m.verify.mockResolvedValue(identity)
  const query = { from: vi.fn(), where: vi.fn(), limit: m.membership }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
  const txQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: m.rows,
    values: m.values,
    set: m.set,
    onConflictDoUpdate: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn().mockResolvedValue([{ id: 'credential1' }]),
  }
  for (const method of [
    txQuery.from,
    txQuery.where,
    txQuery.for,
    txQuery.values,
    txQuery.set,
    txQuery.onConflictDoUpdate,
    txQuery.onConflictDoNothing,
  ])
    method.mockReturnValue(txQuery)
  const tx = {
    execute: vi.fn(),
    select: () => txQuery,
    insert: m.insert.mockReturnValue(txQuery),
    update: m.update.mockReturnValue(txQuery),
  }
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as Parameters<Parameters<typeof db.transaction>[0]>[0])
  )
})
describe('Search OAuth installation', () => {
  it('prepares setup and starts OAuth using the configured app origin', async () => {
    m.baseUrl.mockReturnValue('http://localhost:3000')
    const input = { organizationId: 'org1', name: 'Sim Search', description: 'Search with sources' }
    await expect(prepareSlackSearchSetup.execute({ principal, input })).resolves.toHaveProperty(
      'manifest'
    )
    await expect(
      startSlackSearchSetup.execute({
        principal,
        input: { ...input, clientId: 'client', clientSecret: 'secret', signingSecret: 'signing' },
      })
    ).resolves.toHaveProperty('authorizationUrl')
    expect(m.store).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'http://localhost:3000/api/knowledge/slack/oauth/callback',
      })
    )
    expect(m.exchange).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('opens Slack with the generated JSON manifest prefilled', async () => {
    const prepared = await prepareSlackSearchSetup.execute({
      principal,
      input: { organizationId: 'org1', name: 'Sim Search', description: 'Search with sources' },
    })
    const url = new URL(prepared.createAppUrl)
    expect(url.origin).toBe('https://api.slack.com')
    expect(url.searchParams.get('new_app')).toBe('1')
    expect(JSON.parse(url.searchParams.get('manifest_json')!)).toEqual(
      JSON.parse(prepared.manifest)
    )
  })
  it('stores app secrets separately and binds an organization credential without a workspace in one transaction', async () => {
    expect(await complete()).toEqual({ organizationId: 'org1' })
    expect(db.transaction).toHaveBeenCalledOnce()
    const rows = m.values.mock.calls.map(([value]) => value)
    expect(rows[0]).toMatchObject({
      id: 'A1',
      organizationId: 'org1',
      kind: 'custom',
      encryptedClientSecret: 'encrypted-client',
      encryptedSigningSecret: 'encrypted-signing',
    })
    expect(rows[1]).toMatchObject({
      organizationId: 'org1',
      workspaceId: null,
      type: 'service_account',
      slackAppId: 'A1',
    })
    expect(rows[1].encryptedServiceAccountKey).not.toContain('signingSecret')
    expect(rows[2]).toMatchObject({
      organizationId: 'org1',
      slackAppId: 'A1',
      enabled: true,
      appId: 'A1',
      teamId: 'T1',
    })
    expect(m.audit).toHaveBeenCalledOnce()
  })
  it('rechecks admin access after the provider exchange', async () => {
    m.verify.mockImplementationOnce(async () => {
      m.membership.mockResolvedValue([{ role: 'member' }])
      return identity
    })
    await expect(complete()).rejects.toThrow('administrator')
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it('rejects OAuth replay before contacting Slack', async () => {
    m.consume.mockRejectedValueOnce(new Error('already completed'))
    await expect(complete()).rejects.toThrow('already completed')
    expect(m.exchange).not.toHaveBeenCalled()
  })
  it('rejects an app already owned by a different organization', async () => {
    m.rows.mockResolvedValueOnce([{ kind: 'custom', organizationId: 'other-org' }])
    await expect(complete()).rejects.toThrow('another installation owner')
    expect(m.values).not.toHaveBeenCalled()
  })
  it('rejects another active Search bot in the same Slack workspace', async () => {
    m.rows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'other-installation' }])
    await expect(complete()).rejects.toThrow('already has an active Search installation')
    expect(m.values).not.toHaveBeenCalled()
  })
  it('rejects a provider grant whose app or workspace differs from the bot identity', async () => {
    m.verify.mockResolvedValueOnce({ ...identity, appId: 'OTHER' })
    await expect(complete()).rejects.toThrow('inconsistent installation identity')
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it('preserves installation and credential IDs when reconnecting', async () => {
    const installation = {
      id: 'installation1',
      revision: 'revision1',
      credentialId: 'credential1',
      appId: 'A1',
      teamId: 'T1',
    }
    m.consume.mockResolvedValueOnce({ ...attempt, installation })
    m.rows
      .mockResolvedValueOnce([{ kind: 'custom', organizationId: 'org1' }])
      .mockResolvedValueOnce([{ ...installation, organizationId: 'org1' }])
      .mockResolvedValueOnce([])
    await complete()
    expect(m.values).toHaveBeenCalledOnce()
    expect(m.set.mock.calls[0][0]).toMatchObject({ slackAppId: 'A1', displayName: 'Sim Search' })
    expect(m.set.mock.calls[1][0]).toMatchObject({ slackAppId: 'A1', enabled: true })
  })
  it('rejects a reconnect changed while OAuth was open', async () => {
    const installation = {
      id: 'installation1',
      revision: 'revision1',
      credentialId: 'credential1',
      appId: 'A1',
      teamId: 'T1',
    }
    m.consume.mockResolvedValueOnce({ ...attempt, installation })
    m.rows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...installation, revision: 'rotated', organizationId: 'org1' }])
    await expect(complete()).rejects.toThrow('changed during setup')
    expect(m.values).not.toHaveBeenCalled()
  })
  it('binds setup state to the current admin session and never requests user grants', async () => {
    const result = await startSlackSearchSetup.execute({
      principal,
      input: {
        organizationId: 'org1',
        name: 'Sim Search',
        description: 'Search',
        clientId: 'client',
        clientSecret: 'secret',
        signingSecret: 'signing',
      },
    })
    expect(m.store).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin',
        sessionId: 'session',
        organizationId: 'org1',
        encryptedClientSecret: 'encrypted:secret',
      })
    )
    expect(new URL(result.authorizationUrl).searchParams.has('user_scope')).toBe(false)
  })
})

it('rejects a shared-app callback if the global configuration was disabled or rotated', async () => {
  m.consume.mockResolvedValue({ ...attempt, sharedApp: { id: 'ASHARED', revision: 'app-rev' } })
  await expect(complete()).rejects.toThrow('configuration changed')
  expect(m.exchange).not.toHaveBeenCalled()
  m.shared.mockResolvedValue({ id: 'ASHARED', revision: 'new-rev' })
  await expect(complete()).rejects.toThrow()
  expect(m.exchange).not.toHaveBeenCalled()
})

describe('shared app completion', () => {
  const sharedApp = {
    id: 'A1',
    revision: 'shared-revision',
    kind: 'shared',
    organizationId: null,
    clientId: 'client',
    clientSecret: 'environment-secret',
    signingSecret: 'environment-signing',
  }
  beforeEach(() => {
    m.shared.mockResolvedValue(sharedApp)
    m.consume.mockResolvedValue({
      ...attempt,
      sharedApp: { id: sharedApp.id, revision: sharedApp.revision },
    })
  })

  it('starts shared OAuth without storing deployment secrets in the attempt', async () => {
    const result = await startSlackSearchSetup.execute({
      principal,
      input: {
        organizationId: 'org1',
        mode: 'shared',
        name: 'Sim Search',
        description: 'Search with sources',
      },
    })
    expect(new URL(result.authorizationUrl).searchParams.get('client_id')).toBe('client')
    const stored = m.store.mock.calls[0][0]
    expect(stored.sharedApp).toEqual({ id: 'A1', revision: 'shared-revision' })
    expect(stored).not.toHaveProperty('encryptedClientSecret')
    expect(stored).not.toHaveProperty('encryptedSigningSecret')
    expect(JSON.stringify(stored)).not.toContain('environment-secret')
  })

  describe('custom bot transition', () => {
    const customInstallation = {
      id: 'custom-installation',
      revision: 'custom-revision',
      organizationId: 'org1',
      credentialId: 'custom-credential',
      appId: 'ACUSTOM',
      slackAppId: 'ACUSTOM',
      teamId: 'T1',
      enabled: true,
    }
    const customApp = {
      id: 'ACUSTOM',
      kind: 'custom',
      organizationId: 'org1',
      revision: 'custom-app-revision',
    }
    const memberApp = { appId: 'ACUSTOM', teamId: 'T1' }
    const input = {
      organizationId: 'org1',
      installationId: customInstallation.id,
      mode: 'shared' as const,
      name: 'Sim Search',
      description: 'Search',
    }

    beforeEach(() => {
      m.memberApps.mockResolvedValue([
        { configuration: { slack: { ...memberApp, scopes: ['im:history'] } } },
      ])
      m.consume.mockResolvedValue({
        ...attempt,
        sharedApp: { id: sharedApp.id, revision: sharedApp.revision },
        customInstallation,
        memberApp,
      })
    })

    function queueTransitionRows(custom = customInstallation) {
      m.rows
        .mockResolvedValueOnce([sharedApp])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([custom])
        .mockResolvedValueOnce([])
    }

    it('binds the old installation and workspace without changing anything before approval', async () => {
      m.membership
        .mockResolvedValueOnce([{ role: 'admin' }])
        .mockResolvedValueOnce([customInstallation])
        .mockResolvedValueOnce([customApp])
      const result = await startSlackSearchSetup.execute({ principal, input })
      const url = new URL(result.authorizationUrl)
      expect(url.searchParams.get('team')).toBe('T1')
      expect(url.searchParams.get('client_id')).toBe(sharedApp.clientId)
      expect(url.searchParams.has('user_scope')).toBe(false)
      expect(m.store).toHaveBeenCalledWith(
        expect.objectContaining({
          customInstallation: {
            id: customInstallation.id,
            revision: customInstallation.revision,
            credentialId: customInstallation.credentialId,
            appId: customInstallation.appId,
            teamId: 'T1',
            appRevision: customApp.revision,
          },
          memberApp,
        })
      )
      expect(m.store.mock.calls[0][0]).not.toHaveProperty('installation')
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('keeps the old row and credentials while activating a new bot in one transaction', async () => {
      queueTransitionRows()
      await complete()
      expect(db.transaction).toHaveBeenCalledOnce()
      expect(m.update).toHaveBeenCalledExactlyOnceWith(slackSearchInstallation)
      expect(m.set).toHaveBeenCalledExactlyOnceWith({
        enabled: false,
        revision: expect.not.stringMatching(customInstallation.revision),
        updatedAt: expect.any(Date),
      })
      expect(m.insert).toHaveBeenCalledWith(credential)
      expect(m.values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.not.stringMatching(customInstallation.credentialId),
          organizationId: 'org1',
          slackAppId: 'A1',
          workspaceId: null,
        })
      )
      expect(m.values).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: expect.not.stringMatching(customInstallation.id),
          appId: 'A1',
          teamId: 'T1',
          enabled: true,
        })
      )
      expect(m.adoptMemberApp).not.toHaveBeenCalled()
      expect(m.ensureGroup).not.toHaveBeenCalled()
      expect(m.revoke).not.toHaveBeenCalled()
      expect(m.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ previousInstallationId: customInstallation.id }),
        })
      )
      expect(m.set.mock.invocationCallOrder[0]).toBeLessThan(
        m.values.mock.invocationCallOrder.at(-1)!
      )
    })

    it('refuses a foreign installation before issuing OAuth state', async () => {
      m.membership.mockResolvedValueOnce([{ role: 'admin' }]).mockResolvedValueOnce([])
      await expect(startSlackSearchSetup.execute({ principal, input })).rejects.toThrow('not found')
      expect(m.store).not.toHaveBeenCalled()
    })

    it('rechecks the rollout gate before disabling the old bot', async () => {
      queueTransitionRows()
      m.shared.mockResolvedValueOnce(sharedApp).mockResolvedValueOnce(null)
      await expect(complete()).rejects.toThrow('configuration changed')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.values).not.toHaveBeenCalled()
    })

    it('rejects another active workspace binding even during a custom transition', async () => {
      m.rows
        .mockResolvedValueOnce([sharedApp])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([customInstallation])
        .mockResolvedValueOnce([{ id: 'another-installation' }])
      await expect(complete()).rejects.toThrow('already has an active Search installation')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.values).not.toHaveBeenCalled()
    })

    it('rejects a duplicate completion without revoking the already installed native bot', async () => {
      m.rows
        .mockResolvedValueOnce([sharedApp])
        .mockResolvedValueOnce([{ id: 'native-installation', organizationId: 'org1' }])
        .mockResolvedValueOnce([{ id: 'native-installation' }])
      await expect(complete()).rejects.toThrow('already connected')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.revoke).not.toHaveBeenCalled()
    })

    it('fails the transaction if saving the new installation fails after disabling the custom bot', async () => {
      queueTransitionRows()
      const baseValues = m.values.getMockImplementation()!
      m.values.mockImplementation((value) => {
        if (value.enabled === true) throw new Error('installation write failed')
        return baseValues(value)
      })
      await expect(complete()).rejects.toThrow('installation write failed')
      expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
      await expect(vi.mocked(db.transaction).mock.results[0].value).rejects.toThrow(
        'installation write failed'
      )
      expect(m.audit).not.toHaveBeenCalled()
      expect(m.revoke).toHaveBeenCalledWith('bot-token')
    })

    it('leaves the custom bot untouched when the admin cancels Slack consent', async () => {
      await expect(
        completeSlackSearchSetup.execute({
          principal,
          input: { state: 'state', error: 'access_denied' },
        })
      ).rejects.toThrow('not authorized')
      expect(m.exchange).not.toHaveBeenCalled()
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('rejects a transition to a different Slack workspace', async () => {
      m.exchange.mockResolvedValue({
        app_id: 'A1',
        team: { id: 'T2' },
        bot_user_id: 'UBOT',
        access_token: 'bot-token',
      })
      m.verify.mockResolvedValue({ ...identity, teamId: 'T2' })
      await expect(complete()).rejects.toThrow('same Slack workspace')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.values).not.toHaveBeenCalled()
    })

    it.each([
      { revision: 'changed' },
      { organizationId: 'other-org' },
      { credentialId: 'another-credential' },
      { appId: 'another-app' },
    ])('rejects a stale or foreign custom installation: %j', async (changed) => {
      queueTransitionRows({ ...customInstallation, ...changed })
      await expect(complete()).rejects.toThrow('custom bot changed')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.values).not.toHaveBeenCalled()
    })

    it('refuses an installation removed while OAuth was open', async () => {
      m.rows.mockResolvedValueOnce([sharedApp]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      await expect(complete()).rejects.toThrow('custom bot changed')
      expect(m.update).not.toHaveBeenCalled()
    })

    it('refuses a changed personal source configuration without touching its grants', async () => {
      queueTransitionRows()
      m.memberApps.mockResolvedValue([])
      await expect(complete()).rejects.toThrow('source configuration changed')
      expect(m.update).not.toHaveBeenCalled()
      expect(m.adoptMemberApp).not.toHaveBeenCalled()
      expect(m.ensureGroup).not.toHaveBeenCalled()
    })

    it('rejects a transition when the shared app is disabled', async () => {
      m.shared.mockResolvedValue(null)
      await expect(complete()).rejects.toThrow('configuration changed')
      expect(m.exchange).not.toHaveBeenCalled()
      expect(m.update).not.toHaveBeenCalled()
    })

    it('reconnects the native bot later without changing the custom source configuration', async () => {
      const installed = {
        id: 'native-installation',
        revision: 'native-revision',
        credentialId: 'native-credential',
        appId: 'A1',
        teamId: 'T1',
        organizationId: 'org1',
      }
      m.consume.mockResolvedValue({
        ...attempt,
        sharedApp: { id: sharedApp.id, revision: sharedApp.revision },
        installation: installed,
        memberApp,
      })
      m.rows
        .mockResolvedValueOnce([sharedApp])
        .mockResolvedValueOnce([installed])
        .mockResolvedValueOnce([])
      await complete()
      expect(m.ensureGroup).not.toHaveBeenCalled()
      expect(m.adoptMemberApp).not.toHaveBeenCalled()
      expect(m.set).toHaveBeenCalledWith(
        expect.objectContaining({ slackAppId: 'A1', enabled: true })
      )
    })
  })

  it('creates shared identity without app secrets and installs atomically without registration', async () => {
    m.rows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'accounts', options: [], encryptedProviderConfiguration: null },
      ])
    await expect(complete()).resolves.toEqual({ organizationId: 'org1' })
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(m.ensureGroup).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: 'org1' },
      'admin',
      undefined,
      expect.objectContaining({ insert: expect.any(Function) })
    )
    const group = m.set.mock.calls[0][0]
    expect(group.options).toEqual([
      expect.objectContaining({
        provider: 'slack',
        authorizationAppId: 'slack:A1:T1',
        status: 'active',
        requiredScopes: expect.arrayContaining([
          'channels:history',
          'groups:history',
          'im:history',
          'mpim:history',
          'users:read.email',
        ]),
      }),
    ])
    const configuration = JSON.parse(
      group.encryptedProviderConfiguration.slice('encrypted:'.length)
    )
    expect(configuration.slack).toMatchObject({
      source: 'slack_app',
      appId: 'A1',
      teamId: 'T1',
      scopes: group.options[0].requiredScopes,
    })
    expect(configuration.slack).not.toHaveProperty('clientSecret')
    const rows = m.values.mock.calls.map(([value]) => value)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      id: 'A1',
      kind: 'shared',
      organizationId: null,
      revision: 'shared-revision',
    })
    expect(m.exchange).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'environment-secret' })
    )
    expect(JSON.stringify(rows)).not.toContain('environment-secret')
    expect(JSON.stringify(rows)).not.toContain('environment-signing')
    expect(rows[1]).toMatchObject({
      organizationId: 'org1',
      workspaceId: null,
      type: 'service_account',
      slackAppId: 'A1',
    })
    expect(rows[2]).toMatchObject({
      organizationId: 'org1',
      credentialId: rows[1].id,
      slackAppId: 'A1',
      appId: 'A1',
      teamId: 'T1',
      enabled: true,
    })
    expect(m.verify).toHaveBeenCalledTimes(2)
    expect(m.revoke).not.toHaveBeenCalled()
    expect(m.audit).toHaveBeenCalledOnce()
  })

  it('revokes an unused shared bot grant after a conflicting workspace binding', async () => {
    m.rows
      .mockResolvedValueOnce([sharedApp])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'other-app' }])
    await expect(complete()).rejects.toThrow('already has an active Search installation')
    expect(m.revoke).toHaveBeenCalledWith('bot-token')
    expect(m.values).not.toHaveBeenCalled()
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('revokes an unused shared grant after a database write fails', async () => {
    m.rows.mockResolvedValueOnce([sharedApp]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    m.values.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    await expect(complete()).rejects.toThrow('write failed')
    expect(m.revoke).toHaveBeenCalledWith('bot-token')
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('never revokes a bot with an existing installation when the initiating admin loses access', async () => {
    m.verify.mockImplementationOnce(async () => {
      m.membership.mockResolvedValue([{ role: 'member' }])
      return identity
    })
    m.rows.mockResolvedValueOnce([{ id: 'existing-installation' }])
    await expect(complete()).rejects.toThrow('administrator')
    expect(m.revoke).not.toHaveBeenCalled()
    expect(m.values).not.toHaveBeenCalled()
  })

  it('revokes a shared grant rejected by scope or token-rotation policy', async () => {
    m.validateGrant.mockImplementationOnce(() => {
      throw new Error('unsupported grant')
    })
    await expect(complete()).rejects.toThrow('unsupported grant')
    expect(m.revoke).toHaveBeenCalledWith('bot-token')
    expect(m.values).not.toHaveBeenCalled()
  })

  it('surfaces cleanup failure with a concrete recovery step', async () => {
    m.verify.mockRejectedValueOnce(new Error('invalid bot'))
    m.revoke.mockRejectedValueOnce(new Error('provider failed'))
    await expect(complete()).rejects.toThrow('Remove the unused app in Slack before retrying')
    expect(m.audit).not.toHaveBeenCalled()
  })
})
