import { knowledgeConnector, member, organizationSearchIntegration } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
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

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/sim-search/connectors', () => ({
  canConnectWithDefaults: (meta: { id: string }) => ['google_drive', 'gmail'].includes(meta.id),
  SEARCH_SOURCE_TYPES: [
    ['google_drive', { id: 'google_drive', mirrorsSourceAcls: true, permissionScopedListing: {} }],
    ['gmail', { id: 'gmail', permissionScopedListing: {} }],
    ['github', { id: 'github', permissionScopedListing: {} }],
    ['gitlab', { id: 'gitlab', mirrorsSourceAcls: true }],
  ],
}))

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

const principal = createSessionPrincipal({ userId: 'admin', sessionId: 'session' })
const input = { organizationId: 'organization' }
const health = {
  connectorType: 'google_drive',
  sourceCount: 4,
  pausedCount: 0,
  hasError: false,
  hasAccountError: false,
  hasDocumentError: false,
  hasPermissionError: false,
  hasIndexing: false,
  hasPendingSync: false,
  hasWaiting: false,
  hasUnstarted: false,
}

beforeEach(() => {
  resetDbChainMock()
  knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue(input)
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability.mockResolvedValue({
    memberScoped: true,
    sourceMirrored: true,
  })
})

describe('organization Search administration overview', () => {
  it.each([
    {
      hasPermissionError: true,
      hasAccountError: false,
      hasDocumentError: false,
      issue: 'permission_sync_incomplete',
    },
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
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
        input,
      })
    ).rejects.toThrow()
    expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).not.toHaveBeenCalled()
  })
  it('does not mistake infrastructure failure for an empty integration list', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockRejectedValue(
      new Error('Database unavailable')
    )
    await expect(readOrganizationSearchOverview.execute({ principal, input })).rejects.toThrow(
      'Database unavailable'
    )
  })
  it('does not report indexing when the owner-scoped Search gate is disabled', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(knowledgeConnector, [{ ...health, hasIndexing: true }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: true }])
    knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability.mockResolvedValue({
      memberScoped: false,
      sourceMirrored: false,
    })
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(
      knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability
    ).toHaveBeenCalledWith(input)
    expect(result.providers).toEqual([
      {
        connectorType: 'google_drive',
        sourceCount: 4,
        approved: true,
        status: 'paused',
        issue: null,
        isSyncing: false,
        hasPendingSync: false,
      },
      {
        connectorType: 'gmail',
        sourceCount: 0,
        approved: true,
        status: 'paused',
        issue: null,
        isSyncing: false,
        hasPendingSync: false,
      },
    ])
  })
})
