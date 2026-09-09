/** @vitest-environment node */
import { knowledgeConnector, member, organizationSearchIntegration } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), policy: vi.fn(), availability: vi.fn() }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.policy,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'owner' || role === 'admin',
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mocks.availability,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['google_drive', { mirrorsSourceAcls: true }],
    ['gmail', { permissionScopedListing: {} }],
    ['github', { permissionScopedListing: {} }],
  ],
}))

import { organizationSearchOverviewSchema } from '@/lib/api/contracts/knowledge/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readOrganizationSearchOverview } from '@/lib/knowledge/application/organization-search-overview'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const input = { organizationId: 'organization' }
const health = {
  connectorType: 'google_drive',
  sourceCount: 4,
  pausedCount: 0,
  hasError: false,
  hasIndexing: false,
  hasWaiting: false,
  hasUnstarted: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue(input)
  mocks.policy.mockResolvedValue(null)
  mocks.availability.mockResolvedValue({ memberScoped: true, sourceMirrored: true })
})

describe('organization Search administration overview', () => {
  it('keeps recovery observable while a previous error remains visible', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health, hasError: true, hasIndexing: true }])
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(result.providers).toEqual([
      {
        connectorType: 'google_drive',
        sourceCount: 4,
        approved: true,
        status: 'needs_attention',
        isSyncing: true,
      },
    ])
    expect(organizationSearchOverviewSchema.parse(result)).toEqual(result)
  })

  it.each(['admin', 'owner'])(
    'allows a current %s and returns only operational facts',
    async (role) => {
      queueTableRows(member, [{ role }])
      queueTableRows(knowledgeConnector, [
        { ...health, rawError: 'private', sourceConfig: { token: 'secret' } },
      ])
      queueTableRows(organizationSearchIntegration, [
        { connectorType: 'gmail', approved: true },
        { connectorType: 'github', approved: false },
      ])
      const result = await readOrganizationSearchOverview.execute({ principal, input })
      expect(result).toEqual({
        providers: [
          {
            connectorType: 'google_drive',
            sourceCount: 4,
            approved: true,
            status: 'active',
            isSyncing: false,
          },
          {
            connectorType: 'gmail',
            sourceCount: 0,
            approved: true,
            status: 'waiting_for_connections',
            isSyncing: false,
          },
          {
            connectorType: 'github',
            sourceCount: 0,
            approved: false,
            status: 'paused',
            isSyncing: false,
          },
        ],
      })
      expect(organizationSearchOverviewSchema.parse(result)).toEqual(result)
      expect(JSON.stringify(result)).not.toMatch(/private|secret|DocumentCount|sourceConfig/)
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(100)
    }
  )
  it.each([
    { rows: [{ role: 'member' }], code: 'forbidden' },
    { rows: [], code: 'not_found' },
  ])('refuses unauthorized reads with $code before health queries', async ({ rows, code }) => {
    queueTableRows(member, rows)
    await expect(
      readOrganizationSearchOverview.execute({ principal, input })
    ).rejects.toMatchObject({ code })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(knowledgeConnector)
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(organizationSearchIntegration)
  })
  it('rejects a workspace key before canonical loading', async () => {
    await expect(
      readOrganizationSearchOverview.execute({
        principal: { kind: 'workspace_api_key', keyId: 'key', workspaceId: 'workspace' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('declares administrative session authority without delegation', () => {
    expect(knowledgeOperations.readOrganizationSearchOverview).toMatchObject({
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
      organizationOperation: { minimumRole: 'admin' },
    })
  })
  it('preserves explicit deactivation despite existing sources and hides untouched catalog entries', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health, hasIndexing: true }])
    queueTableRows(organizationSearchIntegration, [
      { connectorType: 'google_drive', approved: false },
    ])
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(result.providers).toEqual([
      {
        connectorType: 'google_drive',
        sourceCount: 4,
        approved: false,
        status: 'paused',
        isSyncing: false,
      },
    ])
  })
  it('does not mistake infrastructure failure for an empty integration list', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.policy.mockRejectedValue(new Error('Database unavailable'))
    await expect(readOrganizationSearchOverview.execute({ principal, input })).rejects.toThrow(
      'Database unavailable'
    )
  })
  it('omits general knowledge-base connectors outside the supported Search catalog', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health, connectorType: 'notion' }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'notion', approved: true }])
    expect(await readOrganizationSearchOverview.execute({ principal, input })).toEqual({
      providers: [],
    })
  })
  it('does not report indexing when the owner-scoped Search gate is disabled', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health, hasIndexing: true }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: true }])
    mocks.availability.mockResolvedValue({ memberScoped: false, sourceMirrored: false })
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(mocks.availability).toHaveBeenCalledWith(input)
    expect(result.providers).toEqual([
      {
        connectorType: 'google_drive',
        sourceCount: 4,
        approved: true,
        status: 'paused',
        isSyncing: false,
      },
      {
        connectorType: 'gmail',
        sourceCount: 0,
        approved: true,
        status: 'paused',
        isSyncing: false,
      },
    ])
  })
})
