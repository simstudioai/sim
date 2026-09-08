/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  hasMockCondition,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyStorageUsageDeltasInTx,
  mockEnsureUserStatsExists,
  mockGetHighestPrioritySubscription,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockEnsureUserStatsExists: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: mockApplyStorageUsageDeltasInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  ensureUserStatsExists: mockEnsureUserStatsExists,
}))

import {
  findActiveKnowledgeBasesByExactName,
  getLegacyPersonalKnowledgeBases,
  getWorkspaceKnowledgeBases,
  KnowledgeBasePermissionError,
  listWorkspaceAndLegacyKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'

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
 * Legacy knowledge bases predate workspaces and carry no `workspaceId`, so their creator is
 * the only possible authority. Workspace-owned rows are read by `getWorkspaceKnowledgeBases`
 * after an application use case authorized the workspace — this query must never widen to
 * them, and must never re-derive workspace access from a `permissions` row, which would
 * contradict an authorization that already passed.
 */
describe('getLegacyPersonalKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reads only the caller’s workspace-less rows', async () => {
    await getLegacyPersonalKnowledgeBases('user-a', 'all')

    const [condition] = dbChainMockFns.where.mock.calls.at(-1) ?? []
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeBase.userId &&
          node.right === 'user-a'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.workspaceId
      )
    ).toBe(true)
    expect(flattenMockConditions(condition).some((node) => node.type === 'or')).toBe(false)
  })

  it('never joins the permissions table', async () => {
    await getLegacyPersonalKnowledgeBases('user-a')

    const joinedTables = dbChainMockFns.leftJoin.mock.calls.map(([table]) => table)
    expect(joinedTables).toContain(schemaMock.document)
    expect(joinedTables).not.toContain(schemaMock.permissions)
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
 * The workspace list and the legacy personal list are separate reads answering to separate
 * authorities, but they render as ONE list — so the merge has to order them together and
 * project connectors once over the result, not once per source.
 */
describe('listWorkspaceAndLegacyKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * Soft-delete cleanup only reclaims archived rows past a retention window — and none at all
   * for a workspace with no retention configured — so a workspace that archives faster than
   * that window crosses any fixed count. This surface has no cursor to page with, so a cap
   * here could only mean a 500 on the knowledge page and Recently Deleted, which is exactly
   * what it meant on staging.
   */
  it('serves a workspace whose archived set is larger than the old row cap', async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => ({
      id: `kb-${index}`,
      chunkingConfig: {},
      docCount: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }))
    dbChainMockFns.orderBy.mockResolvedValueOnce(rows).mockResolvedValueOnce([])

    const result = await listWorkspaceAndLegacyKnowledgeBases('user-a', 'ws-1', 'archived')

    expect(result).toHaveLength(10_001)
    /** Neither the workspace read nor the legacy read may bound itself. */
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('orders both sources as one list and projects connectors once', async () => {
    const workspaceRow = {
      id: 'kb-workspace',
      chunkingConfig: {},
      docCount: 0,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    }
    const legacyRow = {
      id: 'kb-legacy',
      chunkingConfig: {},
      docCount: 0,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    }
    /** Both row reads are unbounded now, so each resolves at `orderBy` rather than `limit`. */
    dbChainMockFns.orderBy.mockResolvedValueOnce([workspaceRow]).mockResolvedValueOnce([legacyRow])

    const result = await listWorkspaceAndLegacyKnowledgeBases('user-a', 'ws-1')

    expect(result.map((kb) => kb.id)).toEqual(['kb-legacy', 'kb-workspace'])
    /** ONE connector projection over the merged set, not one per source. */
    const connectorReads = dbChainMockFns.from.mock.calls.filter(
      ([table]) => table === schemaMock.knowledgeConnector
    )
    expect(connectorReads).toHaveLength(1)
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
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
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
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
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

  it('moves billable bytes from the owner personal counter to a workspace payer', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: null, userId: 'owner' }])
      .mockResolvedValueOnce([{ workspaceId: null, userId: 'owner' }])
      .mockResolvedValueOnce([{ bytes: 321 }])
      .mockResolvedValueOnce([])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')
    mockApplyStorageUsageDeltasInTx.mockResolvedValueOnce(421)

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'owner',
      })
    )

    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [
        {
          context: expect.objectContaining({ workspaceId: 'ws-target' }),
          deltaBytes: 321,
        },
      ],
      legacyDeltas: [{ userId: 'owner', subscription: null, deltaBytes: -321 }],
    })
    expect(mockMaybeNotifyStorageLimitForBillingContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-target' }),
      421
    )
  })

  it('does not re-point bindings when promoting a personal (null-workspace) KB into a workspace', async () => {
    // A null current workspace owns no bindings, so the move must not rewrite
    // any binding — this prevents a key planted in a personal KB from being
    // laundered into the destination workspace on move.
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: null, userId: 'owner' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'owner' })
    )

    // Only the KB row is updated; the binding re-point is skipped entirely.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ workspaceId: 'ws-target' })
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
