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
  canConnectWithDefaults: (meta: { id: string }) => ['google_drive', 'gmail'].includes(meta.id),
  SEARCH_SOURCE_TYPES: [
    ['google_drive', { id: 'google_drive', mirrorsSourceAcls: true, permissionScopedListing: {} }],
    ['gmail', { id: 'gmail', permissionScopedListing: {} }],
    ['github', { id: 'github', permissionScopedListing: {} }],
    ['gitlab', { id: 'gitlab', mirrorsSourceAcls: true }],
  ],
}))

import { organizationSearchOverviewSchema } from '@/lib/api/contracts/knowledge/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readOrganizationSearchOverview } from '@/lib/knowledge/application/organization-search-overview'
import { SOURCE_CONTENT_ERROR } from '@/lib/knowledge/connectors/sync-limits'

/** The global drizzle mock nests fragments as params; flatten one for inspection. */
function renderFragment(fragment: unknown): { sql: string; params: unknown[] } {
  if (!fragment || typeof fragment !== 'object') return { sql: '', params: [] }
  if ('conditions' in fragment && Array.isArray(fragment.conditions)) {
    const parts = fragment.conditions.map(renderFragment)
    return {
      sql: parts.map((part) => part.sql).join(' '),
      params: parts.flatMap((part) => part.params),
    }
  }
  const rendered = (fragment as { toSQL?: () => { sql: string; params: unknown[] } }).toSQL?.()
  if (!rendered) return { sql: '', params: [] }
  const params: unknown[] = []
  let sqlText = rendered.sql
  for (const param of rendered.params) {
    if (param && typeof param === 'object' && 'toSQL' in param) {
      const nested = renderFragment(param)
      sqlText += ` ${nested.sql}`
      params.push(...nested.params)
    } else params.push(param)
  }
  return { sql: sqlText, params }
}

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const input = { organizationId: 'organization' }
const health = {
  connectorType: 'google_drive',
  sourceCount: 4,
  pausedCount: 0,
  hasError: false,
  hasAccountError: false,
  hasDocumentError: false,
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
  it.each([
    { connectorType: 'google_drive', memberScoped: true, status: 'waiting_for_connections' },
    { connectorType: 'google_drive', memberScoped: false, status: 'needs_setup' },
    { connectorType: 'gitlab', memberScoped: true, status: 'needs_setup' },
  ])(
    'reports $connectorType setup with member access $memberScoped',
    async ({ connectorType, memberScoped, status }) => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(organizationSearchIntegration, [{ connectorType, approved: true }])
      mocks.availability.mockResolvedValue({ memberScoped, sourceMirrored: true })
      const result = await readOrganizationSearchOverview.execute({ principal, input })
      expect(result.providers).toEqual([
        { connectorType, approved: true, sourceCount: 0, status, issue: null, isSyncing: false },
      ])
    }
  )
  it.each([
    { hasAccountError: true, hasDocumentError: false, issue: 'account_sync_incomplete' },
    { hasAccountError: false, hasDocumentError: true, issue: 'document_indexing_failed' },
    { hasAccountError: false, hasDocumentError: false, issue: 'sync_failed' },
  ])('identifies $issue without exposing error details', async ({ issue, ...errors }) => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [
      { ...health, ...errors, hasError: true, rawError: 'private provider response' },
    ])
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(result.providers[0]).toMatchObject({ status: 'needs_attention', issue })
    expect(JSON.stringify(result)).not.toContain('private provider response')
  })
  it('does not count the per-document relisting marker as a member account error', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health }])
    await readOrganizationSearchOverview.execute({ principal, input })
    const rendered = dbChainMockFns.where.mock.calls.flatMap((call) => call.map(renderFragment))
    const memberErrorClause = rendered.find((fragment) => fragment.sql.includes("'suspended'"))
    expect(memberErrorClause).toBeDefined()
    expect(memberErrorClause?.sql).toContain('IS NOT NULL AND ? <> ?')
    expect(memberErrorClause?.params).toContain(SOURCE_CONTENT_ERROR)
  })
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
        issue: 'sync_failed',
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
            issue: null,
            isSyncing: false,
          },
          {
            connectorType: 'gmail',
            sourceCount: 0,
            approved: true,
            status: 'waiting_for_connections',
            issue: null,
            isSyncing: false,
          },
          {
            connectorType: 'github',
            sourceCount: 0,
            approved: false,
            status: 'paused',
            issue: null,
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
        issue: null,
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
        issue: null,
        isSyncing: false,
      },
      {
        connectorType: 'gmail',
        sourceCount: 0,
        approved: true,
        status: 'paused',
        issue: null,
        isSyncing: false,
      },
    ])
  })
})
