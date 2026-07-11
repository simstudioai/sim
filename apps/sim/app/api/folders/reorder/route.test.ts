/**
 * Tests for the folder reorder API route.
 *
 * @vitest-environment node
 */

import {
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  resourceLockMockFns,
} from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { db } from '@sim/db'
import { PUT } from '@/app/api/folders/reorder/route'

const mockDb = db as any

describe('PUT /api/folders/reorder', () => {
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockTxUpdate = vi.fn()
  const mockTxSelect = vi.fn()

  /**
   * `performReorderFolders` issues several distinct `tx.select(...).from(...).where(...)`
   * calls inside the transaction (the active-parents recheck, the ancestor-closure
   * walk, and the final `ORDER BY id FOR UPDATE` lock read) -- this queue returns
   * each call's result in order and makes the returned builder both directly
   * awaitable and chainable via `.orderBy()`/`.for()` (both no-ops that return the
   * same thenable), matching how drizzle's query builder supports either usage.
   */
  function queueTxSelectResults(...results: unknown[][]) {
    let call = 0
    mockTxSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const result = results[call] ?? []
          call += 1
          const thenable: any = Promise.resolve(result)
          thenable.orderBy = vi.fn().mockReturnValue(thenable)
          thenable.for = vi.fn().mockReturnValue(thenable)
          return thenable
        }),
      }),
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resourceLockMockFns.mockAssertFolderMutable.mockReset()
    resourceLockMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)

    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    mockDb.select.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })

    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'folder-1' }]),
        }),
      }),
    })
    // Default: closure walk finds no parent (chain ends immediately), lock read
    // finds the folder unlocked.
    queueTxSelectResults([{ id: 'folder-1', parentId: null }], [{ id: 'folder-1', locked: false }])
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ update: mockTxUpdate, select: mockTxSelect })
    )
  })

  it('reorders folders when updates are valid', async () => {
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toMatchObject({ success: true, updated: 1 })
  })

  it('scopes the cycle-detection graph to the batch resourceType and excludes soft-deleted folders', async () => {
    // Regression test: the workspaceFolders query used to build the cycle-check
    // graph previously fetched every folder in the workspace regardless of
    // resourceType or deletedAt -- unrelated trees and deleted nodes could
    // pollute the ancestor walk and produce a false "circular reference" error.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    await PUT(req)

    const workspaceFoldersCondition = mockWhere.mock.calls[1][0]
    expect(workspaceFoldersCondition).toMatchObject({
      type: 'and',
      conditions: expect.arrayContaining([
        { type: 'eq', left: expect.anything(), right: 'workspace-123' },
        { type: 'eq', left: expect.anything(), right: 'workflow' },
        { type: 'isNull', column: expect.anything() },
      ]),
    })
  })

  it('rejects a parentId that belongs to another workspace, failing the whole batch', async () => {
    // Parent-id validity is checked once, inside `performReorderFolders`
    // (via `assertFolderParentValid`) — the route no longer re-implements
    // this check, so the mock sequence covers: (1) route's own-id lookup,
    // (2) route's workspace-folders lookup for the circular-reference walk,
    // (3) orchestration's own-id lookup, (4) orchestration's parentId lookup.
    // A single invalid parentId fails the ENTIRE batch (matching this
    // endpoint's pre-generalization all-or-nothing behavior) rather than
    // silently skipping just that one entry.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])
      .mockReturnValueOnce({ limit: mockLimit })
    mockLimit.mockReturnValueOnce([
      { workspaceId: 'workspace-OTHER', resourceType: 'workflow', deletedAt: null },
    ])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 0, parentId: 'foreign' }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Parent folder not found')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rejects a batch spanning more than one resourceType', async () => {
    mockWhere.mockReturnValueOnce([
      { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      { id: 'folder-2', workspaceId: 'workspace-123', resourceType: 'file' },
    ])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [
        { id: 'folder-1', sortOrder: 0, parentId: null },
        { id: 'folder-2', sortOrder: 0, parentId: null },
      ],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('All folders in a reorder batch must share the same resourceType')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rejects the whole batch when one folder id in a multi-item request is not found', async () => {
    // Regression test: previously a request mixing a valid and an invalid/missing
    // id would silently reorder only the valid one and report success with a
    // smaller `updated` count, giving no indication the other entry was skipped.
    mockWhere.mockReturnValueOnce([
      { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
    ])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [
        { id: 'folder-1', sortOrder: 0, parentId: null },
        { id: 'folder-missing', sortOrder: 1, parentId: null },
      ],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('One or more folders were not found')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rejects a soft-deleted folder id rather than silently reordering it', async () => {
    // Regression test: the route's own existing-folder lookup previously had no
    // deletedAt filter, so a soft-deleted folder id would pass validation and
    // have its sortOrder/parentId mutated by a stale or direct API request.
    mockWhere.mockReturnValueOnce([])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-deleted', sortOrder: 0, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('One or more folders were not found')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rejects an empty updates array', async () => {
    // Regression test: an empty `updates` array previously passed contract
    // validation and crashed the route (validUpdates[0] was undefined) instead
    // of failing cleanly.
    const req = createMockRequest('PUT', { workspaceId: 'workspace-123', updates: [] })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rolls back the whole batch when a folder is concurrently deleted before the write', async () => {
    // Regression test: the transactional write previously only filtered by id,
    // so a folder soft-deleted between validation and the transaction could
    // still have its sortOrder/parentId mutated. The write-time recheck should
    // find no matching row and roll back rather than silently applying it.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]), // row no longer matches (deletedAt set)
        }),
      }),
    })

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('One or more folders were not found')
  })

  it('returns a 500 when the transaction fails for an unexpected reason', async () => {
    // Regression test: performReorderFolders previously mapped every non-lock
    // transaction failure -- including genuine unexpected DB errors, not just
    // client-caused validation issues -- to a 400 in the route. An internal
    // failure should surface as a 500 with a generic message, not leak the raw
    // error or masquerade as a client error.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    mockDb.transaction.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to reorder folders')
  })

  it('returns a 423 when a folder is concurrently locked before the write', async () => {
    // Regression test: the route checks lock state before calling
    // performReorderFolders (both of the route's own checks -- for update.id and
    // update.parentId, since parentId is `null` not `undefined` -- succeed below,
    // simulating the folder being unlocked at that moment), but that's a separate
    // round-trip -- an admin could lock the folder in the window between that
    // check and the transaction. The in-transaction ORDER BY id FOR UPDATE lock
    // read is the recheck this test targets.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    queueTxSelectResults([{ id: 'folder-1', parentId: null }], [{ id: 'folder-1', locked: true }])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(423)
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rejects the write when an ancestor beyond the starting folder is locked', async () => {
    // Regression test: the lock check must walk to ancestors not directly named in
    // the batch (folder-1's own parent) and include them in the single ordered
    // lock read -- not just the ids explicitly present in the batch. This also
    // guards the closure-based fix for the deadlock finding: locking each
    // starting id's ancestor chain separately can still deadlock a concurrent
    // batch, so the whole closure must be computed first and locked in one
    // ORDER BY id FOR UPDATE statement.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: 'ancestor-1' }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    queueTxSelectResults(
      [{ id: 'folder-1', parentId: 'ancestor-1' }], // closure walk, level 1
      [{ id: 'ancestor-1', parentId: null }], // closure walk, level 2 (chain ends)
      [
        { id: 'ancestor-1', locked: true },
        { id: 'folder-1', locked: false },
      ] // single ordered lock read over the whole closure
    )

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(423)
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rejects the write when the target parent is concurrently soft-deleted', async () => {
    // Regression test: assertFolderParentValid only validates the target parent at
    // request-validation time, using the default (non-tx) db client -- a parent
    // soft-deleted after that read but before (or during) this transaction must
    // still be caught. The closure-lock query is the only point where this is
    // race-free: once FOR UPDATE is held on the parent's row, its deletedAt state
    // can't change until this transaction resolves, so that's where the final
    // active check must happen -- not an earlier, unlocked pre-check.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])
      .mockReturnValueOnce({ limit: mockLimit })
    mockLimit.mockReturnValueOnce([
      { workspaceId: 'workspace-123', resourceType: 'workflow', deletedAt: null },
    ])

    queueTxSelectResults(
      [
        { id: 'folder-1', parentId: null },
        { id: 'target-1', parentId: null },
      ], // closure walk, level 1
      [
        { id: 'folder-1', locked: false, deletedAt: null },
        { id: 'target-1', locked: false, deletedAt: new Date() }, // deleted after validation
      ]
    )

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 0, parentId: 'target-1' }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Parent folder not found')
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rejects a batch that would form a cycle', async () => {
    mockWhere
      .mockReturnValueOnce([
        { id: 'A', workspaceId: 'workspace-123' },
        { id: 'B', workspaceId: 'workspace-123' },
      ])
      .mockReturnValueOnce([
        { id: 'A', workspaceId: 'workspace-123', archivedAt: null },
        { id: 'B', workspaceId: 'workspace-123', archivedAt: null },
      ])
      .mockReturnValueOnce([
        { id: 'A', parentId: null },
        { id: 'B', parentId: null },
      ])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [
        { id: 'A', sortOrder: 0, parentId: 'B' },
        { id: 'B', sortOrder: 0, parentId: 'A' },
      ],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Cannot create circular folder reference')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })
})
