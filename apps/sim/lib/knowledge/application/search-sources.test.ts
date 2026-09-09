/** @vitest-environment node */
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  member,
  organizationSearchIntegration,
  user,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  availability: vi.fn(),
  memberships: vi.fn(),
  access: vi.fn(),
  predicate: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mocks.availability,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  resolveViewerConnectorMemberships: mocks.memberships,
}))
vi.mock('@/lib/knowledge/access/scope', () => ({
  createKnowledgeAccessProvider: mocks.access,
}))
vi.mock('@/lib/knowledge/access/predicate', () => ({
  knowledgeAccessCondition: mocks.predicate,
}))
vi.mock('@/connectors/registry', () => {
  const registry = {
    google_drive: { id: 'google_drive', search: true, configFields: [{ id: 'folderId' }] },
    gitlab: { id: 'gitlab', search: true, configFields: [{ id: 'host' }, { id: 'project' }] },
    confluence: {
      id: 'confluence',
      search: true,
      requiresMemberIdentity: true,
      configFields: [{ id: 'domain' }, { id: 'spaceKey' }],
    },
    legacy: { id: 'legacy', search: false, configFields: [{ id: 'project' }] },
    slack: { id: 'slack', search: true, configFields: [{ id: 'channel' }] },
  }
  return {
    CONNECTOR_META_REGISTRY: registry,
    getConnectorMeta: (id: keyof typeof registry) => registry[id],
  }
})

import {
  searchSourceCursorSchema,
  searchSourceSummarySchema,
} from '@/lib/api/contracts/knowledge/connectors'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

const principal = { kind: 'session' as const, userId: 'reader', sessionId: 'session' }
const input = { workspaceId: 'workspace' }
const access = { kind: 'user', userId: principal.userId, tokens: ['u:reader@example.test'] }
const ACL = { type: 'viewer-acl' }
const LAST_SYNC = new Date('2026-09-05T12:00:00.000Z')

function source(id: string, connectorType = 'google_drive', accessMode = 'admin') {
  return {
    id,
    createdAt: '2026-09-05T12:00:00.123456Z',
    knowledgeBaseId: 'search-index',
    connectorType,
    sourceConfig: {
      folderId: 'handbook',
      token: 'secret-fixture',
      adminEmail: 'admin@example.test',
    },
    accessMode,
    status: 'active',
    memberSyncStatus: 'idle',
    lastSyncAt: LAST_SYNC as Date | null,
    hasRetainedSyncError: false,
    lastMemberSyncAt: null as Date | null,
    credentialGroupId: 'group-secret',
    credentialGroupOptionId: 'option-secret',
  }
}

function seed(rows: ReturnType<typeof source>[], emailVerified = true) {
  queueTableRows(knowledgeConnector, rows)
  queueTableRows(user, [{ emailVerified }])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue({
    workspaceId: input.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  })
  mocks.permission.mockResolvedValue('read')
  mocks.availability.mockResolvedValue({ sourceMirrored: true, memberScoped: true })
  mocks.memberships.mockResolvedValue(new Map())
  mocks.access.mockReturnValue({ get: async () => access })
  mocks.predicate.mockReturnValue(ACL)
})

describe('Search source summaries', () => {
  it.each(['read', 'write', 'admin'])(
    'allows a current workspace %s without exposing credentials or other members',
    async (role) => {
      mocks.permission.mockResolvedValue(role)
      seed([source('drive')])
      queueTableRows(document, [{ connectorId: 'drive', count: 4, isIndexing: false }])
      const result = await listSearchSources.execute({ principal, input })
      expect(result.sources).toEqual([
        {
          knowledgeBaseId: 'search-index',
          connectorId: 'drive',
          connectorType: 'google_drive',
          sourceDescription: '1 folder selected',
          accessMode: 'admin',
          availability: 'available',
          enabled: true,
          isSyncing: false,
          lastSyncAt: LAST_SYNC.toISOString(),
          hasSyncError: false,
          viewerDocumentCount: 4,
          viewerFailedDocumentCount: 0,
          viewerEmailVerified: true,
          connectionRequired: false,
          viewerMembership: null,
        },
      ])
      expect(searchSourceSummarySchema.parse(result.sources[0])).toEqual(result.sources[0])
      expect(JSON.stringify(result)).not.toMatch(
        /secret-fixture|admin@example|group-secret|option-secret|sourceConfig/
      )
      expect(mocks.context).toHaveBeenCalledWith(input)
      expect(mocks.access).toHaveBeenCalledWith(principal, {
        workspaceId: 'workspace',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
      })
      expect(mocks.predicate).toHaveBeenCalledWith(access)
    }
  )

  it('lists central, identity and member sources separately, preserving multiple sites', async () => {
    const first = {
      ...source('confluence-a', 'confluence'),
      sourceConfig: { domain: 'one.atlassian.net', spaceKey: 'ENG' },
    }
    const second = {
      ...source('confluence-b', 'confluence'),
      sourceConfig: { domain: 'two.atlassian.net', spaceKey: 'ENG' },
    }
    const slack = {
      ...source('slack', 'slack', 'members'),
      lastSyncAt: null,
      lastMemberSyncAt: LAST_SYNC,
      memberSyncStatus: 'running',
    }
    seed([source('drive'), source('gitlab', 'gitlab'), first, second, slack])
    mocks.memberships.mockResolvedValue(
      new Map([
        ['confluence-a', 'connected'],
        ['slack', 'invited'],
      ])
    )
    const { sources } = await listSearchSources.execute({ principal, input })
    expect(
      sources.map((row) => [row.connectorId, row.connectionRequired, row.viewerMembership])
    ).toEqual([
      ['drive', false, null],
      ['gitlab', false, null],
      ['confluence-a', true, 'connected'],
      ['confluence-b', true, null],
      ['slack', true, 'invited'],
    ])
    expect(sources[2].sourceDescription).toBe('one.atlassian.net · ENG')
    expect(sources[3].sourceDescription).toBe('two.atlassian.net · ENG')
    expect(sources[4]).toMatchObject({ lastSyncAt: LAST_SYNC.toISOString(), isSyncing: true })
  })

  it.each([
    [
      { sourceMirrored: true, memberScoped: false },
      ['available', 'available', 'unavailable', 'unavailable'],
    ],
    [
      { sourceMirrored: false, memberScoped: true },
      ['unavailable', 'unavailable', 'unavailable', 'available'],
    ],
    [
      { sourceMirrored: false, memberScoped: false },
      ['unavailable', 'unavailable', 'unavailable', 'unavailable'],
    ],
  ])(
    'keeps configured sources visible when independent availability changes: %o',
    async (availability, expected) => {
      seed([
        source('drive'),
        source('gitlab', 'gitlab'),
        source('confluence', 'confluence'),
        source('slack', 'slack', 'members'),
      ])
      mocks.availability.mockResolvedValue(availability)
      mocks.memberships.mockResolvedValue(
        new Map([
          ['confluence', 'connected'],
          ['slack', 'connected'],
        ])
      )
      const { sources } = await listSearchSources.execute({ principal, input })
      expect(sources.map((row) => row.availability)).toEqual(expected)
      for (const row of sources.filter((row) => row.availability === 'unavailable')) {
        expect(row).toMatchObject({
          enabled: true,
          isSyncing: false,
          viewerMembership: null,
          viewerDocumentCount: 0,
        })
      }
    }
  )

  it('distinguishes paused, failed, initial and still-indexing sources without raw errors', async () => {
    seed(
      [
        { ...source('paused'), status: 'paused' },
        { ...source('failed'), status: 'error' },
        { ...source('initial'), lastSyncAt: null },
        source('indexing'),
      ],
      false
    )
    queueTableRows(document, [{ connectorId: 'indexing', count: 2, isIndexing: true }])
    const { sources } = await listSearchSources.execute({ principal, input })
    expect(sources[0]).toMatchObject({
      enabled: false,
      availability: 'available',
      isSyncing: false,
    })
    expect(sources[1]).toMatchObject({ hasSyncError: true, isSyncing: false })
    expect(sources[2]).toMatchObject({ lastSyncAt: null, isSyncing: false })
    expect(sources[3]).toMatchObject({ viewerDocumentCount: 2, isSyncing: true })
    expect(sources.every((row) => row.viewerEmailVerified === false)).toBe(true)
  })

  it('surfaces retained partial sync errors without returning the private error message', async () => {
    seed([{ ...source('drive'), hasRetainedSyncError: true }])
    const result = await listSearchSources.execute({ principal, input })
    expect(result.sources[0].hasSyncError).toBe(true)
    expect(result.sources[0]).not.toHaveProperty('lastSyncError')
  })

  it('preserves legacy configured sources even when they are no longer offered for new Search setup', async () => {
    seed([source('legacy', 'legacy', 'members'), source('unknown', 'unregistered', 'admin')])
    const { sources } = await listSearchSources.execute({ principal, input })
    expect(sources.map((row) => row.connectorId)).toEqual(['legacy', 'unknown'])
    expect(sources[0]).toMatchObject({ availability: 'available', connectionRequired: true })
    expect(sources[1]).toMatchObject({ availability: 'unavailable', sourceDescription: '' })
  })

  it('restricts the source query to this workspace, the Search index, and live configured sources', async () => {
    seed([])
    await expect(listSearchSources.execute({ principal, input })).resolves.toEqual({
      sources: [],
      nextCursor: null,
    })
    expect(dbChainMockFns.where.mock.calls[0][0]).toEqual({
      type: 'and',
      conditions: expect.arrayContaining([
        {
          type: 'and',
          conditions: [
            { type: 'eq', left: knowledgeBase.workspaceId, right: 'workspace' },
            { type: 'isNull', column: knowledgeBase.organizationId },
          ],
        },
        { type: 'eq', left: knowledgeBase.isSearchIndex, right: true },
        { type: 'isNull', column: knowledgeBase.deletedAt },
        { type: 'isNull', column: knowledgeConnector.archivedAt },
        { type: 'isNull', column: knowledgeConnector.deletedAt },
        { type: 'inArray', column: knowledgeConnector.accessMode, values: ['admin', 'members'] },
      ]),
    })
    expect(mocks.memberships).not.toHaveBeenCalled()
  })

  it('counts only accessible, enabled, completed documents with enabled chunks, without counting chunks twice', async () => {
    seed([source('drive')])
    await listSearchSources.execute({ principal, input })
    expect(dbChainMockFns.where.mock.calls.at(-1)?.[0]).toEqual({
      type: 'and',
      conditions: expect.arrayContaining([
        { type: 'inArray', column: document.connectorId, values: ['drive'] },
        { type: 'eq', left: document.enabled, right: true },
        { type: 'eq', left: document.userExcluded, right: false },
        { type: 'isNull', column: document.archivedAt },
        { type: 'isNull', column: document.deletedAt },
        ACL,
      ]),
    })
    const projection = dbChainMockFns.select.mock.calls.at(-1)?.[0]
    expect(projection.count.toSQL().sql).toMatch(/count\(\*\) FILTER[\s\S]*'completed'/)
    expect(projection.count.values).toEqual([
      document.processingStatus,
      expect.objectContaining({ type: 'exists' }),
    ])
    expect(dbChainMockFns.where.mock.calls).toContainEqual([
      {
        type: 'and',
        conditions: [
          { type: 'eq', left: embedding.documentId, right: document.id },
          { type: 'eq', left: embedding.enabled, right: true },
        ],
      },
    ])
    expect(projection.isIndexing.toSQL().sql).toContain("IN ('pending', 'processing')")
  })

  it('rejects a former workspace member before querying source data', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(listSearchSources.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.memberships).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'personal_api_key', userId: 'reader', keyId: 'key' },
    { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
    {
      kind: 'credential_group_enrollment',
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'reader@example.test',
      invitationTokenHash: 'hash',
    },
  ] as const)('refuses $kind before canonical lookup', async (other) => {
    await expect(listSearchSources.execute({ principal: other, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.context).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('propagates infrastructure failures instead of returning an empty configured-source list', async () => {
    seed([source('drive')])
    mocks.availability.mockRejectedValue(new Error('availability backend unavailable'))
    await expect(listSearchSources.execute({ principal, input })).rejects.toThrow(
      'availability backend unavailable'
    )
  })
})

describe('organization Search source summaries', () => {
  it.each(['member', 'admin'])(
    'returns only the current %s viewer ACL counts without a workspace membership',
    async (role) => {
      mocks.context.mockResolvedValue({ organizationId: 'org-1' })
      queueTableRows(member, [{ role }])
      seed([source('drive')])
      queueTableRows(document, [{ connectorId: 'drive', count: 2, isIndexing: false }])
      const result = await listSearchSources.execute({
        principal,
        input: { organizationId: 'org-1' },
      })
      expect(result.sources[0]).toMatchObject({
        connectorId: 'drive',
        viewerDocumentCount: 2,
        viewerEmailVerified: true,
      })
      expect(mocks.access).toHaveBeenCalledWith(principal, { organizationId: 'org-1' })
      expect(mocks.predicate).toHaveBeenCalledWith(access)
      expect(mocks.memberships).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'reader' })
      )
      expect(mocks.permission).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toMatch(
        /secret-fixture|admin@example|group-secret|option-secret/
      )
    }
  )
  it('keeps deactivated pending sources idle in full summaries as well as progress probes', async () => {
    mocks.context.mockResolvedValue({ organizationId: 'org-1' })
    queueTableRows(member, [{ role: 'admin' }])
    seed([{ ...source('drive'), status: 'pending' }])
    queueTableRows(organizationSearchIntegration, [
      { connectorType: 'google_drive', approved: false },
    ])
    const result = await listSearchSources.execute({
      principal,
      input: { organizationId: 'org-1' },
    })
    expect(result.sources[0]).toMatchObject({ approved: false, isSyncing: false })
  })

  it('rejects a removed organization member without exposing configured sources', async () => {
    mocks.context.mockResolvedValue({ organizationId: 'org-1' })
    queueTableRows(member, [])
    await expect(
      listSearchSources.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('Organization not found')
    expect(mocks.memberships).not.toHaveBeenCalled()
    expect(mocks.access).not.toHaveBeenCalled()
  })
})

describe('bounded Search progress', () => {
  it('reports visible pending and failed work without counting documents or chunks', async () => {
    queueTableRows(knowledgeConnector, [
      {
        connectorId: 'drive',
        approved: true,
        status: 'active',
        accessMode: 'admin',
        memberSyncStatus: 'idle',
        isIndexing: true,
        hasIndexingError: true,
      },
    ])
    const result = await readSearchSourceProgress.execute({
      principal,
      input: { ...input, connectorIds: ['drive'] },
    })
    expect(result).toEqual({
      sources: [
        { connectorId: 'drive', isSyncing: true, hasSyncError: false, hasIndexingError: true },
      ],
    })
    expect(mocks.predicate).toHaveBeenCalledWith(access)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(100)
    expect(dbChainMockFns.select.mock.calls.every(([projection]) => !('count' in projection))).toBe(
      true
    )
    expect(dbChainMockFns.where.mock.calls).toContainEqual([
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          { type: 'eq', left: document.knowledgeBaseId, right: knowledgeConnector.knowledgeBaseId },
          { type: 'eq', left: document.connectorId, right: knowledgeConnector.id },
          { type: 'isNull', column: document.deletedAt },
          { type: 'isNull', column: document.archivedAt },
          { type: 'eq', left: document.userExcluded, right: false },
          { type: 'eq', left: document.enabled, right: true },
          ACL,
        ]),
      }),
    ])
  })

  it('keeps a paused source idle despite pending documents', async () => {
    queueTableRows(knowledgeConnector, [
      {
        connectorId: 'drive',
        approved: true,
        status: 'paused',
        accessMode: 'admin',
        memberSyncStatus: 'idle',
        isIndexing: true,
        hasIndexingError: false,
      },
    ])
    const result = await readSearchSourceProgress.execute({
      principal,
      input: { ...input, connectorIds: ['drive'] },
    })
    expect(result.sources[0].isSyncing).toBe(false)
  })

  it('does not read progress for a former member', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(
      readSearchSourceProgress.execute({ principal, input: { ...input, connectorIds: ['drive'] } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('rejects an oversized progress request before document work', async () => {
    await expect(
      readSearchSourceProgress.execute({
        principal,
        input: { ...input, connectorIds: Array(101).fill('drive') },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('does not report pending source work after organization approval is removed', async () => {
    queueTableRows(knowledgeConnector, [
      {
        connectorId: 'drive',
        approved: false,
        status: 'pending',
        accessMode: 'admin',
        memberSyncStatus: 'idle',
        isIndexing: false,
        hasIndexingError: false,
      },
    ])
    const result = await readSearchSourceProgress.execute({
      principal,
      input: { ...input, connectorIds: ['drive'] },
    })
    expect(result.sources[0].isSyncing).toBe(false)
  })

  it('counts visible indexing failures separately from provider sync errors', async () => {
    seed([source('drive')])
    queueTableRows(document, [
      { connectorId: 'drive', count: 3, failedCount: 2, isIndexing: false },
    ])
    const { sources } = await listSearchSources.execute({ principal, input })
    expect(sources[0]).toMatchObject({
      hasSyncError: false,
      viewerFailedDocumentCount: 2,
      viewerDocumentCount: 3,
      isSyncing: false,
    })
  })
})

describe('bounded Search source pagination', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => source(`source-${String(index).padStart(3, '0')}`))

  it('counts only the returned page and preserves submillisecond cursor precision', async () => {
    seed(rows(101))
    const result = await listSearchSources.execute({ principal, input })
    expect(result.sources).toHaveLength(25)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(101)
    expect(mocks.memberships.mock.calls[0][0].connectors).toHaveLength(100)
    const cursor = searchSourceCursorSchema.parse(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString())
    )
    expect(cursor).toMatchObject({ id: 'source-024', createdAt: '2026-09-05T12:00:00.123456Z' })
    expect(dbChainMockFns.where.mock.calls).toContainEqual([
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          { type: 'inArray', column: document.connectorId, values: rows(25).map((row) => row.id) },
        ]),
      }),
    ])
  })

  it('advances over an empty filtered candidate page without claiming the list ended', async () => {
    seed(rows(101))
    const result = await listSearchSources.execute({
      principal,
      input: { ...input, search: 'missing' },
    })
    expect(result.sources).toEqual([])
    expect(result.nextCursor).not.toBeNull()
    expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()).id).toBe(
      'source-099'
    )
    expect(
      dbChainMockFns.select.mock.calls.every(([projection]) => !('failedCount' in projection))
    ).toBe(true)
  })

  it('ends a sparse final page and applies the verified personal membership filter', async () => {
    const candidates = rows(100)
    seed(candidates)
    mocks.memberships.mockResolvedValue(
      new Map([
        ['source-097', 'connected'],
        ['source-098', 'needs_reauth'],
      ])
    )
    const result = await listSearchSources.execute({ principal, input: { ...input, mine: true } })
    expect(result.sources.map((row) => row.connectorId)).toEqual(['source-097'])
    expect(result.nextCursor).toBeNull()
  })

  it('filters the candidate query by provider before applying pagination', async () => {
    seed([source('drive')])
    await listSearchSources.execute({
      principal,
      input: { ...input, connectorType: 'google_drive' },
    })
    expect(dbChainMockFns.where.mock.calls).toContainEqual([
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          { type: 'eq', left: knowledgeConnector.connectorType, right: 'google_drive' },
        ]),
      }),
    ])
  })

  it.each(['filter', 'provider', 'viewer', 'scope'] as const)(
    'rejects a cursor replayed under a different %s before reading sources',
    async (change) => {
      seed(rows(26))
      const first = await listSearchSources.execute({ principal, input })
      resetDbChainMock()
      if (change === 'scope')
        mocks.context.mockResolvedValue({
          workspaceId: 'other-workspace',
          workspaceOrganizationId: null,
          allowPersonalApiKeys: true,
        })
      await expect(
        listSearchSources.execute({
          principal: change === 'viewer' ? { ...principal, userId: 'other-reader' } : principal,
          input: {
            ...input,
            cursor: first.nextCursor!,
            ...(change === 'filter' ? { mine: true } : {}),
            ...(change === 'provider' ? { connectorType: 'gmail' } : {}),
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
})

describe('Search source overview', () => {
  it('returns provider existence and readable search readiness without loading source configuration', async () => {
    queueTableRows(knowledgeConnector, [
      { connectorType: 'google_drive' },
      { connectorType: 'github' },
    ])
    queueTableRows(knowledgeConnector, [{ connectorType: 'github' }])
    queueTableRows(document, [{ id: 'readable-document' }])
    const result = await readSearchSourceOverview.execute({ principal, input })
    expect(result).toEqual({
      providers: [
        { connectorType: 'google_drive', isSyncing: false },
        { connectorType: 'github', isSyncing: true },
      ],
      hasSearchableDocuments: true,
    })
    expect(mocks.predicate).toHaveBeenCalledWith(access)
    expect(mocks.memberships).not.toHaveBeenCalled()
    expect(
      dbChainMockFns.select.mock.calls.every(
        ([projection]) => !('sourceConfig' in projection) && !('count' in projection)
      )
    ).toBe(true)
  })

  it('does not confuse configured sources with searchable documents or expose gated progress', async () => {
    mocks.availability.mockResolvedValue({ memberScoped: false, sourceMirrored: false })
    queueTableRows(knowledgeConnector, [{ connectorType: 'google_drive' }])
    const result = await readSearchSourceOverview.execute({ principal, input })
    expect(result).toEqual({
      providers: [{ connectorType: 'google_drive', isSyncing: false }],
      hasSearchableDocuments: false,
    })
  })

  it('rechecks current membership before reading the overview', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(readSearchSourceOverview.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.access).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
