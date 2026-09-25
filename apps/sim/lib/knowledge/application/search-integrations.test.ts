import {
  knowledgeConnector,
  member,
  organization,
  organizationSearchIntegration,
} from '@sim/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  source: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/sim-search/live/service-sources', () => ({ loadLiveServiceSource: hoisted.source }))
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['gmail', { name: 'Gmail' }],
    ['google_drive', { name: 'Google Drive' }],
    ['github', { name: 'GitHub' }],
    ['jira', { name: 'Jira' }],
  ],
  searchMemberAccountProvider: (type: string) =>
    type === 'google_drive'
      ? 'google-drive'
      : ['gmail', 'jira', 'github'].includes(type)
        ? type === 'github'
          ? 'github-repositories'
          : type
        : null,
}))

import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

const mocks = {
  ...hoisted,
  memberSetup: credentialGroupsServiceMockFns.mockAddOrganizationAccountProvider,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}

const principal = createSessionPrincipal({ userId: 'actor', sessionId: 'session' })
const input = { organizationId: 'organization', connectorType: 'gmail', approved: true }

beforeEach(() => {
  resetDbChainMock()
  resetEnvFlagsMock()
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  mocks.source.mockResolvedValue({ id: 'source' })
  mocks.memberSetup.mockResolvedValue({ groupId: 'group', changed: false })
  mocks.available.mockResolvedValue(true)
  knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
    organizationId: input.organizationId,
  })
})

describe('organization Search approval', () => {
  it.each(['owner', 'admin'])(
    'allows %s approval without creating sources, credentials or an index',
    async (role) => {
      queueTableRows(member, [{ role }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ connectorType: 'gmail' }])
      await expect(approveSearchIntegration.execute({ principal, input })).resolves.toMatchObject({
        approved: true,
        changed: true,
      })
      expect(dbChainMockFns.insert).toHaveBeenCalledExactlyOnceWith(organizationSearchIntegration)
      expect(dbChainMockFns.values).toHaveBeenCalledWith({
        organizationId: 'organization',
        connectorType: 'gmail',
        approved: true,
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          metadata: expect.objectContaining({ organizationId: 'organization', approved: true }),
        })
      )
    }
  )

  it.each([
    { rows: [{ role: 'member' }], code: 'forbidden' },
    { rows: [], code: 'not_found' },
  ])('refuses unauthorized approval with $code', async ({ rows, code }) => {
    queueTableRows(member, rows)
    await expect(approveSearchIntegration.execute({ principal, input })).rejects.toMatchObject({
      code,
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('rejects unsupported principal kinds before canonical loading', async () => {
    await expect(
      approveSearchIntegration.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', apiKeyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).not.toHaveBeenCalled()
  })

  it('rejects unknown integration types', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    await expect(
      approveSearchIntegration.execute({ principal, input: { ...input, connectorType: 'unknown' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not emit audit for an unchanged decision', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(organizationSearchIntegration, [])
    await expect(approveSearchIntegration.execute({ principal, input })).resolves.toMatchObject({
      changed: false,
    })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('preserves existing sources while an explicit deactivation overrides them', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: false }])
    queueTableRows(knowledgeConnector, [
      { connectorType: 'gmail' },
      { connectorType: 'google_drive' },
    ])
    await expect(
      listSearchIntegrations.execute({ principal, input: { organizationId: 'organization' } })
    ).resolves.toEqual([
      { connectorType: 'gmail', approved: false },
      { connectorType: 'google_drive', approved: true },
      { connectorType: 'github', approved: false },
      { connectorType: 'jira', approved: false },
    ])
  })
})

const delegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'organization',
  delegationId: 'source-tool',
  audience: 'sim:knowledge',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const

describe('organization Search controls through Mothership', () => {
  it.each(['admin', 'owner'])(
    'authorizes the current delegated %s and attributes their approval',
    async (role) => {
      queueTableRows(member, [{ role }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ connectorType: 'gmail' }])
      await expect(
        approveSearchIntegration.execute({ principal: delegatedPrincipal, input })
      ).resolves.toMatchObject({ approved: true, changed: true })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor' })
      )
    }
  )

  it.each([
    { rows: [{ role: 'member' }], code: 'forbidden' },
    { rows: [], code: 'not_found' },
  ])('rechecks membership before changing approval: $code', async ({ rows, code }) => {
    queueTableRows(member, rows)
    await expect(
      approveSearchIntegration.execute({ principal: delegatedPrincipal, input })
    ).rejects.toMatchObject({ code })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it.each([
    { organizationId: 'another-organization' },
    { audience: 'sim:files' },
    { expiresAt: new Date(0) },
    { issuedAt: new Date(Date.now() + 300_000) },
  ])('rejects invalid delegation before protected writes', async (change) => {
    await expect(
      approveSearchIntegration.execute({ principal: { ...delegatedPrincipal, ...change }, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('allows delegated members to read approval state without granting writes', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: true }])
    queueTableRows(knowledgeConnector, [])
    await expect(
      listSearchIntegrations.execute({
        principal: delegatedPrincipal,
        input: { organizationId: 'organization' },
      })
    ).resolves.toContainEqual({ connectorType: 'gmail', approved: true })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

it('enforces the organization Knowledge capability for delegated admins', async () => {
  queueTableRows(member, [{ role: 'admin' }])
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
    hideKnowledgeBaseTab: true,
  })
  await expect(
    approveSearchIntegration.execute({ principal: delegatedPrincipal, input })
  ).rejects.toThrow()
  expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
})

describe('live organization search policies', () => {
  it.each([principal, delegatedPrincipal])(
    'repairs an already approved member source through the same atomic admin action',
    async (actor) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
      queueTableRows(member, [{ role: 'admin' }])
      mocks.memberSetup.mockResolvedValueOnce({ groupId: 'group', changed: true })
      const result = await approveSearchIntegration.execute({
        principal: actor,
        input: { ...input, connectorType: 'jira', policy: defaultLiveSearchPolicy() },
      })
      expect(result).toMatchObject({ approved: true, changed: true })
      expect(mocks.memberSetup).toHaveBeenCalledWith(
        'organization',
        'actor',
        { provider: 'jira', label: 'Jira' },
        expect.any(Object)
      )
      expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'credential_group.updated',
          actorId: 'actor',
          resourceId: 'group',
        })
      )
    }
  )

  it.each([principal, delegatedPrincipal])(
    'requires integrations capability before provisioning sign-in for an authorized admin',
    async (actor) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
      queueTableRows(member, [{ role: 'admin' }])
      permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
        hideIntegrationsTab: true,
      })
      await expect(
        approveSearchIntegration.execute({
          principal: actor,
          input: { ...input, connectorType: 'jira' },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.memberSetup).not.toHaveBeenCalled()
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    }
  )

  it('does not approve a source when member sign-in setup fails', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    mocks.memberSetup.mockRejectedValueOnce(new Error('Provider configuration is unavailable'))
    await expect(approveSearchIntegration.execute({ principal, input })).rejects.toThrow(
      'Provider configuration is unavailable'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('explains missing OAuth app setup instead of approving a source with an unusable connection', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    mocks.memberSetup.mockRejectedValueOnce(
      new CredentialGroupProviderConfigurationError('Managed Jira authorization is not configured')
    )
    await expect(
      approveSearchIntegration.execute({ principal, input: { ...input, connectorType: 'jira' } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Managed Jira authorization is not configured',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('does not provision sign-in while removing a source', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    await approveSearchIntegration.execute({ principal, input: { ...input, approved: false } })
    expect(mocks.memberSetup).not.toHaveBeenCalled()
  })
  it('clears source settings when switching to member accounts', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    const result = await approveSearchIntegration.execute({
      principal,
      input: {
        ...input,
        policy: {
          ...defaultLiveSearchPolicy(),
          sourceId: 'previous-source',
          mode: 'selected',
          included: ['INBOX'],
          excluded: ['Personal'],
        },
      },
    })
    expect(result.policy).toEqual(defaultLiveSearchPolicy())
    expect(mocks.source).not.toHaveBeenCalled()
  })

  it.each([
    { error: new NativeSearchError('unavailable', 'Source is unavailable'), code: 'validation' },
    { error: new Error('Database unavailable'), code: undefined },
  ])(
    'rejects unavailable sources before writing without masking infrastructure errors',
    async ({ error, code }) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
      queueTableRows(member, [{ role: 'admin' }])
      mocks.source.mockRejectedValueOnce(error)
      const attempt = approveSearchIntegration.execute({
        principal,
        input: {
          ...input,
          policy: {
            ...defaultLiveSearchPolicy(),
            accessMode: 'service_account',
            sourceId: 'source',
          },
        },
      })
      if (code) await expect(attempt).rejects.toMatchObject({ code, message: error.message })
      else await expect(attempt).rejects.toBe(error)
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('rejects policy writes when the rollout flag is off', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    await expect(
      approveSearchIntegration.execute({
        principal,
        input: { ...input, policy: defaultLiveSearchPolicy() },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('saves a validated service source and its approval in one transaction', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    const result = await approveSearchIntegration.execute({
      principal,
      input: {
        ...input,
        connectorType: 'google_drive',
        policy: {
          ...defaultLiveSearchPolicy(),
          accessMode: 'service_account',
          sourceId: 'source',
          mode: 'selected',
          included: ['https://drive.google.com/drive/folders/team', 'team'],
        },
      },
    })
    expect(result.policy).toMatchObject({
      accessMode: 'service_account',
      sourceId: 'source',
      included: [],
    })
    expect(mocks.source).toHaveBeenCalledWith(
      { organizationId: 'organization' },
      'google_drive',
      'source',
      { requireApproved: false }
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledWith(organization)
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(organizationSearchIntegration)
    expect(result.changed).toBe(true)
  })
  it('allows GitHub App mode without a single source ID', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    const result = await approveSearchIntegration.execute({
      principal,
      input: {
        ...input,
        connectorType: 'github',
        policy: { ...defaultLiveSearchPolicy(), accessMode: 'service_account' },
      },
    })
    expect(result.policy).toMatchObject({ accessMode: 'service_account' })
    expect(result.policy?.sourceId).toBeUndefined()
    expect(mocks.source).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })
  it('saves an unfinished service-account source without exposing member-mode search', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    const result = await approveSearchIntegration.execute({
      principal,
      input: {
        ...input,
        policy: { ...defaultLiveSearchPolicy(), accessMode: 'service_account' },
      },
    })
    expect(result.policy).toMatchObject({ accessMode: 'service_account' })
    expect(result.policy?.sourceId).toBeUndefined()
    expect(mocks.source).not.toHaveBeenCalled()
  })
  it('rejects invalid scope data before any protected write', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    await expect(
      approveSearchIntegration.execute({
        principal,
        input: { ...input, policy: { ...defaultLiveSearchPolicy(), mode: 'selected' } },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('prevents members from changing live search scopes', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      approveSearchIntegration.execute({
        principal,
        input: { ...input, policy: defaultLiveSearchPolicy() },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
  it('reads saved policies alongside inherited approval without requiring an index', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: true }])
    queueTableRows(organization, [
      {
        metadata: {
          liveSearchPolicies: { gmail: { ...defaultLiveSearchPolicy(), excluded: ['Personal'] } },
        },
      },
    ])
    const rows = await listSearchIntegrations.execute({
      principal,
      input: { organizationId: 'organization' },
    })
    expect(rows.find((row) => row.connectorType === 'gmail')).toMatchObject({
      approved: true,
      policy: { accessMode: 'member', excluded: [] },
    })
  })
})
