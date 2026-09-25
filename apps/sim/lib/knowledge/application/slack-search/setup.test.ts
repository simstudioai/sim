import { db } from '@sim/db'
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
  connectCustomSlackSearch,
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
  it('rejects a provider grant whose app or workspace differs from the bot identity', async () => {
    m.verify.mockResolvedValueOnce({ ...identity, appId: 'OTHER' })
    await expect(complete()).rejects.toThrow('inconsistent installation identity')
    expect(db.transaction).not.toHaveBeenCalled()
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

it('rejects a shared-app callback if organization access was disabled or configuration rotated', async () => {
  m.consume.mockResolvedValue({ ...attempt, sharedApp: { id: 'ASHARED', revision: 'app-rev' } })
  await expect(complete()).rejects.toThrow('configuration changed')
  expect(m.shared).toHaveBeenCalledWith('org1')
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

  it('only offers and starts shared OAuth for the enabled organization', async () => {
    m.shared.mockImplementation(async (orgId) => (orgId === 'org1' ? sharedApp : null))
    const details = { name: 'Sim Search', description: 'Search with sources' }
    await expect(
      prepareSlackSearchSetup.execute({ principal, input: { ...details, organizationId: 'org1' } })
    ).resolves.toHaveProperty('sharedAppId', 'A1')
    await expect(
      prepareSlackSearchSetup.execute({ principal, input: { ...details, organizationId: 'org2' } })
    ).resolves.toHaveProperty('sharedAppId', null)
    await expect(
      startSlackSearchSetup.execute({
        principal,
        input: { ...details, organizationId: 'org2', mode: 'shared' },
      })
    ).rejects.toThrow('unavailable')
    expect(m.store).not.toHaveBeenCalled()
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
    const _customApp = {
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

    it('refuses a foreign installation before issuing OAuth state', async () => {
      m.membership.mockResolvedValueOnce([{ role: 'admin' }]).mockResolvedValueOnce([])
      await expect(startSlackSearchSetup.execute({ principal, input })).rejects.toThrow('not found')
      expect(m.store).not.toHaveBeenCalled()
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
})

describe('connect an app already installed through a Slack manifest', () => {
  const input = {
    organizationId: 'org1',
    name: 'Sim Search',
    description: 'Search',
    clientId: 'client',
    clientSecret: 'client-secret',
    signingSecret: 'signing-secret',
    botToken: 'xoxb-installed-token',
  }
  const connect = () => connectCustomSlackSearch.execute({ principal, input })

  it('rejects non-admins before verifying a token', async () => {
    m.membership.mockResolvedValue([{ role: 'member' }])
    await expect(connect()).rejects.toThrow('administrator')
    expect(m.verify).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it.each(['xoxp-user', 'xapp-app', 'xoxe.xoxb-rotating'])(
    'rejects unsupported tokens before contacting Slack: %s',
    async (botToken) => {
      await expect(
        connectCustomSlackSearch.execute({ principal, input: { ...input, botToken } })
      ).rejects.toThrow('token rotation disabled')
      expect(m.verify).not.toHaveBeenCalled()
      expect(db.transaction).not.toHaveBeenCalled()
    }
  )

  it.each([
    { kind: 'custom', organizationId: 'other-org' },
    { kind: 'shared', organizationId: null },
  ])('does not claim an app owned by $kind / $organizationId', async (app) => {
    m.rows.mockResolvedValueOnce([app])
    await expect(connect()).rejects.toThrow('another installation owner')
    expect(m.values).not.toHaveBeenCalled()
    expect(m.revoke).not.toHaveBeenCalled()
  })

  it('rejects a token from a different app than member indexing', async () => {
    m.memberApps.mockResolvedValue([
      {
        configuration: {
          slack: {
            appId: 'AOTHER',
            teamId: 'T1',
            scopes: [],
          },
        },
      },
    ])
    await expect(connect()).rejects.toThrow('same Slack app and workspace')
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
