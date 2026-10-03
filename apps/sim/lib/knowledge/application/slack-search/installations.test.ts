import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { sha256Hex } from '@sim/security/hash'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credential: vi.fn(),
  verifyBot: vi.fn(),
  membership: vi.fn(),
  txLimit: vi.fn(),
  returning: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  loadSlackSearchCredential: mocks.credential,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({
  verifySlackSearchBot: mocks.verifyBot,
  SlackSearchProviderError: class extends Error {},
  SlackSearchConfigurationError: class extends Error {},
}))
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import {
  configureSlackSearchInstallation,
  listSlackSearchInstallations,
  removeSlackSearchInstallation,
} from '@/lib/knowledge/application/slack-search/installations'
import {
  projectSlackSearchSettingsForTool,
  slackSearchSettingsPatchSchema,
} from '@/lib/knowledge/application/slack-search/settings-projection'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

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
const principal = createSessionPrincipal({ userId: 'admin', sessionId: 's1' })
const input = { organizationId: 'org1', credentialId: 'cred1', enabled: true }

beforeEach(() => {
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  mocks.membership.mockResolvedValue([{ role: 'admin' }])
  mocks.credential.mockResolvedValue({
    botToken: 'secret-token',
    signingSecret: 'signing-secret',
    version: sha256Hex('encrypted'),
  })
  mocks.verifyBot.mockResolvedValue(identity)
  knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
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
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws1', keyId: 'key' }),
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
    expect(mocks.verifyBot).toHaveBeenCalledWith('secret-token', expect.any(AbortSignal), undefined)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
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
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})

const delegated: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  organizationId: 'org1',
  subjectUserId: 'admin',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'chat' },
}

describe('Slack Search Settings delegation', () => {
  it('rechecks organization admin authority for status, configure, and remove', async () => {
    mocks.membership.mockResolvedValue([{ role: 'member' }])
    await expect(
      listSlackSearchInstallations.authorize({
        principal: delegated,
        input: { organizationId: 'org1' },
      })
    ).rejects.toThrow('administrator')
    await expect(
      configureSlackSearchInstallation.authorize({ principal: delegated, input })
    ).rejects.toThrow('administrator')
    await expect(
      removeSlackSearchInstallation.authorize({
        principal: delegated,
        input: { organizationId: 'org1', installationId: 'install1' },
      })
    ).rejects.toThrow('administrator')
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it.each([
    { ...delegated, audience: 'sim:knowledge' },
    { ...delegated, organizationId: 'other-org' },
    { ...delegated, expiresAt: new Date(0) },
    {
      ...delegated,
      serviceId: 'slack-search' as const,
      resourceScope: { installationId: 'install1', eventId: 'event' },
    },
  ])(
    'refuses stale or wrongly scoped delegated settings before reading credentials',
    async (caller) => {
      await expect(
        configureSlackSearchInstallation.execute({ principal: caller, input })
      ).rejects.toThrow()
      expect(mocks.credential).not.toHaveBeenCalled()
      expect(mocks.insert).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    }
  )
  it('does not bypass the organization knowledge capability', async () => {
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideKnowledgeBaseTab: true,
    })
    await expect(
      configureSlackSearchInstallation.execute({ principal: delegated, input })
    ).rejects.toThrow()
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it('rejects secret fields at the tool boundary', () => {
    expect(
      slackSearchSettingsPatchSchema.safeParse({ credentialId: 'cred1', enabled: true }).success
    ).toBe(true)
    expect(
      slackSearchSettingsPatchSchema.safeParse({
        credentialId: 'cred1',
        enabled: true,
        botToken: 'secret',
      }).success
    ).toBe(false)
  })
  it('projects bounded metadata without provider outcomes or credential payloads', () => {
    const result = projectSlackSearchSettingsForTool({
      sharedAppAvailable: true,
      bots: [{ id: 'cred1', displayName: 'Bot' }],
      installations: [
        {
          id: 'install1',
          credentialId: 'cred1',
          appId: 'A1',
          appKind: 'custom',
          teamId: 'T1',
          teamName: 'Team',
          enabled: true,
          needsValidation: false,
          lastEventAt: null,
          lastOutcome: 'secret',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result.installations[0]).toMatchObject({
      id: 'install1',
      credentialId: 'cred1',
      enabled: true,
    })
  })
})
