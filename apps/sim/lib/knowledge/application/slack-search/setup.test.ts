/** @vitest-environment node */
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
}))
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
  getBaseUrl: () => 'https://sim.test',
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
vi.mock('@/lib/internal/slack/oauth', () => ({ exchangeSlackBotAuthorization: m.exchange }))
vi.mock('@/lib/credential-groups/organization-slack-app', () => ({
  loadOrganizationSlackMemberApps: async () => [],
  adoptOrganizationSlackMemberApp: vi.fn(),
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
    returning: vi.fn().mockResolvedValue([{ id: 'credential1' }]),
  }
  for (const method of [
    txQuery.from,
    txQuery.where,
    txQuery.for,
    txQuery.values,
    txQuery.set,
    txQuery.onConflictDoUpdate,
  ])
    method.mockReturnValue(txQuery)
  const tx = {
    execute: vi.fn(),
    select: () => txQuery,
    insert: () => txQuery,
    update: () => txQuery,
  }
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as Parameters<Parameters<typeof db.transaction>[0]>[0])
  )
})
describe('Search OAuth installation', () => {
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
