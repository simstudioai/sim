/**
 * Tests for the folder reorder API route.
 *
 * @vitest-environment node
 */

import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
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
    mockTxSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    })
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

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('One or more folders were not found')
  })

  it('returns a 423 when a folder is concurrently locked before the write', async () => {
    // Regression test: the route checks lock state before calling
    // performReorderFolders (both of the route's own checks -- for update.id and
    // update.parentId, since parentId is `null` not `undefined` -- succeed below,
    // simulating the folder being unlocked at that moment), but that's a separate
    // round-trip -- an admin could lock the folder in the window between that
    // check and the transaction. The third assertFolderMutable call is the new
    // in-transaction recheck this test targets.
    mockWhere
      .mockReturnValueOnce([
        { id: 'folder-1', workspaceId: 'workspace-123', resourceType: 'workflow' },
      ])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])

    resourceLockMockFns.mockAssertFolderMutable
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ResourceLockedError('workflow', false, 'Folder is locked'))

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(423)
    expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledTimes(3)
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
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
