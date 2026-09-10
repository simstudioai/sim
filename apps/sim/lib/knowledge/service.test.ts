/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeAccessProvider } from '@/lib/knowledge/access/types'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

const {
  mockApplyStorageUsageDeltasInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: mockApplyStorageUsageDeltasInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

import {
  attachKnowledgeBaseConnectors,
  findActiveKnowledgeBasesByExactName,
  getActiveKnowledgeBaseReference,
  getActiveKnowledgeBaseReferences,
  getKnowledgeBaseById,
  getWorkspaceKnowledgeBases,
  KnowledgeBasePermissionError,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'

describe('knowledge base references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('loads active identity and embedding configuration without aggregating documents', async () => {
    const reference = {
      id: 'kb-1',
      name: 'Organization search',
      workspaceId: null,
      organizationId: 'org-1',
      isSearchIndex: true,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
      chunkingConfig: { maxSize: 512, minSize: 50, overlap: 100 },
    }
    dbChainMockFns.limit.mockResolvedValueOnce([reference])

    await expect(getActiveKnowledgeBaseReference('kb-1')).resolves.toEqual(reference)

    const [condition] = dbChainMockFns.where.mock.calls[0] ?? []
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'eq' && node.left === schemaMock.knowledgeBase.id && node.right === 'kb-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.deletedAt
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('reports a missing or archived reference as absent', async () => {
    await expect(getActiveKnowledgeBaseReference('missing')).resolves.toBeNull()
  })

  it('loads twenty references in one query without changing their projection or input order', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `kb-${index}`)
    const references = ids.map((id) => ({ id, chunkingConfig: { maxSize: 512 } }))
    queueTableRows(schemaMock.knowledgeBase, [...references].reverse())

    await expect(getActiveKnowledgeBaseReferences(ids)).resolves.toEqual(references)

    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    expect(dbChainMockFns.from).toHaveBeenCalledOnce()
    const projection = dbChainMockFns.select.mock.calls[0][0]
    const [condition] = dbChainMockFns.where.mock.calls[0]
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.deletedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.knowledgeBase.id &&
          JSON.stringify(node.values) === JSON.stringify(ids)
      )
    ).toBe(true)
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()

    await getActiveKnowledgeBaseReference(ids[0])
    expect(dbChainMockFns.select.mock.calls[1][0]).toEqual(projection)
  })

  it('preserves duplicate and absent reference positions without querying duplicate ids', async () => {
    const reference = { id: 'kb-1', chunkingConfig: {} }
    queueTableRows(schemaMock.knowledgeBase, [reference])

    await expect(
      getActiveKnowledgeBaseReferences(['missing', 'kb-1', 'missing', 'kb-1'])
    ).resolves.toEqual([null, reference, null, reference])
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0][0],
        (node) =>
          node.type === 'inArray' &&
          JSON.stringify(node.values) === JSON.stringify(['missing', 'kb-1'])
      )
    ).toBe(true)
  })

  it('does not query an empty reference batch and retains the singleton query shape', async () => {
    await expect(getActiveKnowledgeBaseReferences([])).resolves.toEqual([])
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    await expect(getActiveKnowledgeBaseReferences(['missing'])).resolves.toEqual([null])
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })

  it('propagates reference batch database failures', async () => {
    const failure = new Error('reference database unavailable')
    dbChainMockFns.where.mockRejectedValueOnce(failure)
    await expect(getActiveKnowledgeBaseReferences(['kb-1', 'kb-2'])).rejects.toBe(failure)
  })

  it('preserves aggregate counts for knowledge-base detail consumers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'kb-1',
        chunkingConfig: { maxSize: 512, minSize: 50, overlap: 100 },
        docCount: 3,
        tokenCount: 1536,
      },
    ])

    await expect(getKnowledgeBaseById('kb-1')).resolves.toMatchObject({
      docCount: 3,
      tokenCount: 1536,
      connectorTypes: [],
      hasPermissionScopedConnector: false,
    })
    expect(dbChainMockFns.leftJoin).toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).toHaveBeenCalled()
  })
})

/**
 * A row cap on this read could only ever fire for a caller that did NOT ask for a page — the
 * one kind of caller with no cursor to act on it — so an oversized workspace has to be served,
 * not refused.
 */
describe('getWorkspaceKnowledgeBases — paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reads unbounded when the caller asked for no page', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: `kb-${index}`,
        chunkingConfig: {},
        docCount: 0,
      }))
    )

    const result = await getWorkspaceKnowledgeBases('ws-1')

    expect(result.data).toHaveLength(10_001)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('reads one row past the page so it can report another page', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce(
        Array.from({ length: 3 }, (_, index) => ({
          id: `kb-${index}`,
          chunkingConfig: {},
          docCount: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }))
      )
      .mockResolvedValueOnce([])

    const result = await getWorkspaceKnowledgeBases('ws-1', 'active', { limit: 2 })

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    expect(result.data).toHaveLength(2)
    expect(result.nextCursorKeys).not.toBeNull()
  })
})

/**
 * A VFS path names one knowledge base exactly. Resolving it by reading every base whose name
 * merely CONTAINS the term, then filtering in JS, makes a single-row lookup scale with the
 * workspace — the sibling `findActiveTablesByExactName` is the shape to match.
 */
describe('findActiveKnowledgeBasesByExactName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('matches the name exactly and reads at most two rows', async () => {
    await findActiveKnowledgeBasesByExactName('ws-1', 'Docs')

    const [condition] = dbChainMockFns.where.mock.calls[0] ?? []
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'eq' && node.left === schemaMock.knowledgeBase.name && node.right === 'Docs'
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(2)
  })
})

/**
 * These tests guard the workspace mass-assignment fix:
 * a user with write/admin on the *source* workspace must not be able to move a
 * knowledge base into a workspace where they have no permission, and must not
 * be able to clear `workspaceId` (which would orphan the KB to its original
 * `userId`, who may not be the caller).
 */
describe('updateKnowledgeBase — chunking config persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
  })

  /**
   * The strategy fields are the half a `{ maxSize, minSize, overlap }` shape
   * cannot describe, so they are what a narrower write type — or a destructure
   * of only those three — drops. Nothing downstream re-derives them.
   */
  it('persists every declared chunking field, strategy included', async () => {
    await updateKnowledgeBase(
      'kb-1',
      {
        chunkingConfig: {
          maxSize: 512,
          minSize: 50,
          overlap: 100,
          strategy: 'markdown',
          strategyOptions: { headingDepth: 3 },
        },
      },
      'req-1'
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkingConfig: {
          maxSize: 512,
          minSize: 50,
          overlap: 100,
          strategy: 'markdown',
          strategyOptions: { headingDepth: 3 },
        },
      })
    )
  })

  it('omits the strategy fields a caller did not set', async () => {
    await updateKnowledgeBase(
      'kb-1',
      { chunkingConfig: { maxSize: 512, minSize: 50, overlap: 100 } },
      'req-1'
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkingConfig: { maxSize: 512, minSize: 50, overlap: 100 },
      })
    )
  })
})

describe('updateKnowledgeBase — workspace transfer authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    mockResolveStorageBillingContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      billedAccountUserId: `${workspaceId}-owner`,
      billingEntity: { type: 'user', id: `${workspaceId}-owner` },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }))
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(100)
  })

  it('rejects workspaceId change without actorUserId', async () => {
    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1')
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it.each(['owner', 'other-user'])(
    'rejects detaching a KB for %s before any writes',
    async (actorUserId) => {
      await expect(
        /** @ts-expect-error Exercise runtime callers that bypass the HTTP contract. */
        updateKnowledgeBase('kb-1', { workspaceId: null }, 'req-1', { actorUserId })
      ).rejects.toMatchObject({ code: 'validation', message: 'Workspace ID is required' })
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockApplyStorageUsageDeltasInTx).not.toHaveBeenCalled()
      expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    }
  )

  it('rejects an empty destination before any writes', async () => {
    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: '' }, 'req-1', { actorUserId: 'owner' })
    ).rejects.toMatchObject({ code: 'validation', message: 'Workspace ID is required' })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('rejects transfer when actor has no permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'attacker',
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'User does not have permission on the target workspace',
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'attacker',
      'workspace',
      'ws-target'
    )
  })

  it('rejects transfer when actor only has read permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'reader',
      })
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
  })

  it('throws when knowledge base does not exist during transfer', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      updateKnowledgeBase('kb-missing', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'u-1',
      })
    ).rejects.toThrow('Knowledge base kb-missing not found')
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('locks the knowledge base row (SELECT … FOR UPDATE) and enforces the pre-resolved permission', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'attacker',
      })
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })
})

/**
 * These tests guard the file-authorization follow-through: KB file ownership is
 * resolved from the trusted `workspace_files` binding, so when a KB moves to a
 * new workspace the bindings for its stored files must move with it. Otherwise
 * the bindings stay frozen at the upload-time workspace and the KB's files
 * become unreadable after a move.
 */
describe('updateKnowledgeBase — file ownership binding re-point on workspace change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    mockResolveStorageBillingContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      billedAccountUserId: `${workspaceId}-owner`,
      billingEntity: { type: 'user', id: `${workspaceId}-owner` },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }))
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(100)
  })

  // The mocked `@sim/db` cannot satisfy the post-transaction read-back select, so
  // the call rejects after the transaction body commits. These tests assert the
  // in-transaction binding statements, then swallow that read-back rejection.
  const runIgnoringReadBack = (promise: Promise<unknown>) => promise.catch(() => undefined)

  it('re-points file ownership bindings to the new workspace on a move', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'u-1' })
    )

    // Two updates inside the txn: the KB row, then the file bindings.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ workspaceId: 'ws-target' })
  })

  it('transfers the SQL-summed non-connector bytes with pre-resolved payer contexts', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
      .mockResolvedValueOnce([{ bytes: 321 }])
      .mockResolvedValueOnce([])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'u-1',
      })
    )

    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('ws-current')
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('ws-target')
    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [
        {
          context: expect.objectContaining({ workspaceId: 'ws-current' }),
          deltaBytes: -321,
        },
        {
          context: expect.objectContaining({ workspaceId: 'ws-target' }),
          deltaBytes: 321,
        },
      ],
      legacyDeltas: [],
    })
  })

  it('rejects moving an organization Search KB into a workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: null, organizationId: 'org-1', isSearchIndex: true, userId: 'creator' },
    ])

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'admin' })
    ).rejects.toThrow('Only workspace knowledge bases can move between workspaces')
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockApplyStorageUsageDeltasInTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not touch bindings when the workspace is unchanged', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-current' }, 'req-1', { actorUserId: 'u-1' })
    )

    // Only the KB row is updated; no binding re-point statement runs.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ workspaceId: 'ws-current' })
  })

  it('does not touch bindings when no workspace change is requested', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }]) // currentKb lock
      .mockResolvedValueOnce([]) // duplicate-name check: none

    await runIgnoringReadBack(updateKnowledgeBase('kb-1', { name: 'Renamed' }, 'req-1'))

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })
})

describe('knowledge base counts with live source permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  function reader() {
    const scope = { kind: 'user' as const, userId: 'reader', tokens: ['reader-token'] }
    const getForConnectors = vi.fn().mockResolvedValue({
      ...scope,
      confluenceSiteGrants: [
        {
          cloudId: 'cloud-1',
          connectorId: 'confluence-source',
          contentCredentialId: 'crawler',
          readerCredentialId: 'reader-credential',
          readerSubjectToken: 'reader-token',
          domain: 'team.atlassian.net',
        },
      ],
    })
    const access: KnowledgeAccessProvider = {
      get: async () => scope,
      getForConnectors,
      getForDocuments: async () => scope,
    }
    return { access, getForConnectors }
  }

  it('sums ordinary and live-authorized documents once in a paginated list', async () => {
    const { access, getForConnectors } = reader()
    queueTableRows(schemaMock.knowledgeBase, [
      {
        id: 'kb-1',
        workspaceId: 'ws-1',
        chunkingConfig: {},
        docCount: 99,
        tokenCount: 999,
        createdAt: new Date('2026-01-01'),
      },
    ])
    queueTableRows(schemaMock.document, [{ knowledgeBaseId: 'kb-1', docCount: 2, tokenCount: 10 }])
    queueTableRows(schemaMock.document, [{ connectorId: 'confluence-source' }])
    queueTableRows(schemaMock.document, [{ knowledgeBaseId: 'kb-1', docCount: 3, tokenCount: 20 }])
    const result = await getWorkspaceKnowledgeBases('ws-1', 'active', { access, limit: 2 })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ docCount: 5, tokenCount: 30 })
    expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['confluence-source'], undefined)
    expect(dbChainMockFns.selectDistinct).toHaveBeenCalledWith({
      connectorId: schemaMock.document.connectorId,
    })
    expect(
      dbChainMockFns.where.mock.calls.every(
        ([condition]) =>
          hasMockCondition(
            condition,
            (node) => node.type === 'inArray' && node.column === schemaMock.knowledgeBase.id
          ) ||
          hasMockCondition(
            condition,
            (node) => node.type === 'eq' && node.left === schemaMock.knowledgeBase.workspaceId
          ) ||
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'inArray' &&
              node.column === schemaMock.knowledgeConnector.knowledgeBaseId
          )
      )
    ).toBe(true)
  })

  it('does not retain stale totals when a live source no longer authorizes its documents', async () => {
    const { access, getForConnectors } = reader()
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [{ connectorId: 'confluence-source' }])
    queueTableRows(schemaMock.document, [])
    const base = { id: 'kb-1', docCount: 5, tokenCount: 50 } as KnowledgeBaseWithCounts
    await expect(attachKnowledgeBaseConnectors(base, access)).resolves.toMatchObject({
      docCount: 0,
      tokenCount: 0,
    })
    expect(getForConnectors).toHaveBeenCalledOnce()
  })
})
