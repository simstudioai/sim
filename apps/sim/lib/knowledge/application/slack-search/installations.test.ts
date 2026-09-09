/** @vitest-environment node */
import { db } from '@sim/db'
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credential: vi.fn(),
  verifyBot: vi.fn(),
  available: vi.fn(),
  membership: vi.fn(),
  txLimit: vi.fn(),
  returning: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.available,
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  loadSlackSearchCredential: mocks.credential,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({
  verifySlackSearchBot: mocks.verifyBot,
  SlackSearchProviderError: class extends Error {},
  SlackSearchConfigurationError: class extends Error {},
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))

import { configureSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/installations'

const credential = {
  id: 'cred1',
  organizationId: 'org1',
  type: 'service_account',
  providerId: 'slack-custom-bot',
  encryptedServiceAccountKey: 'encrypted',
}
const identity = {
  appId: 'A1',
  teamId: 'T1',
  teamName: 'Acme',
  botUserId: 'UBOT',
  enterpriseId: null,
}
const principal = { kind: 'session', userId: 'admin', sessionId: 's1' } as const
const input = { organizationId: 'org1', credentialId: 'cred1', enabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.membership.mockResolvedValue([{ role: 'admin' }])
  mocks.credential.mockResolvedValue({
    botToken: 'secret-token',
    signingSecret: 'signing-secret',
    version: sha256Hex('encrypted'),
  })
  mocks.verifyBot.mockResolvedValue(identity)
  mocks.available.mockResolvedValue(undefined)
  mocks.txLimit
    .mockReset()
    .mockResolvedValue([])
    .mockResolvedValueOnce([credential])
    .mockResolvedValueOnce([])
  mocks.returning.mockResolvedValue([{ id: 'install1' }])
  const query = { from: vi.fn(), where: vi.fn(), limit: mocks.membership }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
  const txQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: mocks.txLimit,
    set: vi.fn(),
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: mocks.returning,
  }
  for (const method of [
    txQuery.from,
    txQuery.where,
    txQuery.for,
    txQuery.set,
    txQuery.values,
    txQuery.onConflictDoNothing,
  ])
    method.mockReturnValue(txQuery)
  mocks.insert.mockReturnValue(txQuery)
  mocks.update.mockReturnValue(txQuery)
  const tx = { execute: vi.fn(), select: () => txQuery, insert: mocks.insert, update: mocks.update }
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as Parameters<Parameters<typeof db.transaction>[0]>[0])
  )
})

describe('Slack Search installation configuration', () => {
  it('requires a current organization administrator before loading credentials', async () => {
    mocks.membership.mockResolvedValue([{ role: 'member' }])
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'administrator'
    )
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('never accepts a workspace key for setup', async () => {
    await expect(
      configureSlackSearchInstallation.execute({
        principal: { kind: 'workspace_api_key', keyId: 'key', workspaceId: 'ws1' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it('validates the connected organization credential before inserting a binding', async () => {
    await expect(configureSlackSearchInstallation.execute({ principal, input })).resolves.toEqual({
      id: 'install1',
    })
    expect(mocks.credential).toHaveBeenCalledWith('cred1', 'org1')
    expect(mocks.verifyBot).toHaveBeenCalledWith('secret-token', expect.any(AbortSignal))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        metadata: expect.objectContaining({ installationId: 'install1', enabled: true }),
      })
    )
  })
  it('does not enable a bot whose validation failed', async () => {
    mocks.verifyBot.mockRejectedValueOnce(new Error('missing scope'))
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'missing scope'
    )
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('requires the organization-scoped credential lookup to succeed', async () => {
    mocks.credential.mockRejectedValueOnce(new Error('Organization Slack bot not found'))
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'not found'
    )
    expect(mocks.verifyBot).not.toHaveBeenCalled()
  })
  it('rejects concurrent credential rotation instead of binding a stale token', async () => {
    mocks.txLimit
      .mockReset()
      .mockResolvedValueOnce([{ ...credential, encryptedServiceAccountKey: 'rotated' }])
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'credential changed'
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('does not reconnect a binding to another app or Slack workspace', async () => {
    mocks.txLimit
      .mockReset()
      .mockResolvedValueOnce([credential])
      .mockResolvedValueOnce([
        { id: 'install1', organizationId: 'org1', appId: 'A2', teamId: 'T1' },
      ])
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'same Slack app'
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('reports a conflicting app/workspace installation without stealing it', async () => {
    mocks.returning.mockResolvedValueOnce([])
    await expect(configureSlackSearchInstallation.execute({ principal, input })).rejects.toThrow(
      'already connected'
    )
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('allows disabling a broken connection without contacting Slack', async () => {
    mocks.txLimit
      .mockReset()
      .mockResolvedValueOnce([credential])
      .mockResolvedValueOnce([{ id: 'install1', organizationId: 'org1', ...identity }])
    await configureSlackSearchInstallation.execute({
      principal,
      input: { ...input, enabled: false },
    })
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.verifyBot).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledOnce()
  })
})
