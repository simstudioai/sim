/** @vitest-environment node */
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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), audit: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => ['owner', 'admin'].includes(role),
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['gmail', { name: 'Gmail' }],
    ['google_drive', { name: 'Google Drive' }],
  ],
}))

import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

const principal = { kind: 'session', sessionId: 'session', userId: 'actor' } as const
const input = { organizationId: 'organization', connectorType: 'gmail', approved: true }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  resetEnvFlagsMock()
  mocks.config.mockResolvedValue(null)
  mocks.context.mockResolvedValue({ organizationId: input.organizationId })
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
      expect(mocks.audit).toHaveBeenCalledWith(
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
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects unsupported principal kinds before canonical loading', async () => {
    await expect(
      approveSearchIntegration.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', apiKeyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
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
    expect(mocks.audit).not.toHaveBeenCalled()
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
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor' }))
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
    expect(mocks.audit).not.toHaveBeenCalled()
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
    expect(mocks.audit).not.toHaveBeenCalled()
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
  mocks.config.mockResolvedValue({ hideKnowledgeBaseTab: true })
  await expect(
    approveSearchIntegration.execute({ principal: delegatedPrincipal, input })
  ).rejects.toThrow()
  expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
})

describe('live organization search policies', () => {
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
  it('saves a normalized scope and its approval in one transaction', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(member, [{ role: 'admin' }])
    const result = await approveSearchIntegration.execute({
      principal,
      input: {
        ...input,
        connectorType: 'google_drive',
        policy: {
          ...defaultLiveSearchPolicy(),
          mode: 'selected',
          included: ['https://drive.google.com/drive/folders/team', 'team'],
        },
      },
    })
    expect(result.policy?.included).toEqual(['team'])
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledWith(organization)
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(organizationSearchIntegration)
    expect(result.changed).toBe(true)
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
      policy: { excluded: ['Personal'] },
    })
  })
})
