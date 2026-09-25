import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderCollectionFullError, FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import { folderMutationStatus } from '@/lib/folders/status'

const {
  mockArchiveFolderCascade,
  mockCollectArchivedSubtreeIds,
  mockCollectCascadeSubtreeIds,
  mockDeduplicateFolderName,
  mockGetWorkspaceWithOwner,
  mockGuardDelete,
  mockRestoreChildren,
  mockRestoreFolderChildren,
  mockRestoreFolderRows,
  mockWouldCreateFolderCycle,
  mockLoadActiveFolderPathIndex,
  mockAssertFolderCollectionHasRoom,
  resourceConfig,
} = vi.hoisted(() => ({
  mockArchiveFolderCascade: vi.fn(),
  mockCollectArchivedSubtreeIds: vi.fn(),
  mockCollectCascadeSubtreeIds: vi.fn(),
  mockDeduplicateFolderName: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockGuardDelete: vi.fn(),
  mockRestoreChildren: vi.fn(),
  mockRestoreFolderChildren: vi.fn(),
  mockRestoreFolderRows: vi.fn(),
  mockWouldCreateFolderCycle: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  mockAssertFolderCollectionHasRoom: vi.fn(),
  resourceConfig: { current: {} as Record<string, unknown> },
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/folders/cascade', () => ({
  archiveFolderCascade: mockArchiveFolderCascade,
  collectArchivedSubtreeIds: mockCollectArchivedSubtreeIds,
  collectCascadeSubtreeIds: mockCollectCascadeSubtreeIds,
  restoreFolderChildren: mockRestoreFolderChildren,
  restoreFolderRows: mockRestoreFolderRows,
  toCascadeCounts: (
    config: { countKey: string },
    counts: { folders: number; children: number }
  ) => ({ folders: counts.folders, [config.countKey]: counts.children }),
}))

vi.mock('@/lib/folders/config', () => ({
  folderResourceConfig: () => resourceConfig.current,
}))

vi.mock('@/lib/folders/naming', () => ({ deduplicateFolderName: mockDeduplicateFolderName }))

vi.mock('@/lib/folders/queries', () => ({
  wouldCreateFolderCycle: mockWouldCreateFolderCycle,
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
  assertFolderCollectionHasRoom: mockAssertFolderCollectionHasRoom,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import {
  createFolder,
  createFolderAtPathTransition,
  deleteFolder,
  deleteFolderByPath,
  relocateFolderByPath,
  restoreFolder,
  updateFolder,
} from '@/lib/folders/orchestration'

const CHILD_TABLE = { name: 'child_table' }

/** Stand-in for the per-resource config; each test declares only the deltas it exercises. */
function setConfig(overrides: Record<string, unknown> = {}) {
  resourceConfig.current = {
    resourceType: 'table',
    label: 'table',
    countKey: 'tables',
    table: CHILD_TABLE,
    idColumn: 'child.id',
    folderIdColumn: 'child.folderId',
    workspaceColumn: 'child.workspaceId',
    deletedColumn: 'child.archivedAt',
    deletedKey: 'archivedAt',
    ...overrides,
  }
}

/** Shaped like what the `postgres` driver throws on the active-name partial unique index. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  })
}

const DUPLICATE_NAME_ERROR = 'A folder with this name already exists in this location'

const ARCHIVED_AT = new Date('2026-01-01T00:00:00.000Z')

function folderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'folder-1',
    resourceType: 'table',
    name: 'Reports',
    userId: 'user-1',
    workspaceId: 'ws-1',
    parentId: null,
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    updatedAt: new Date('2025-12-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

const baseCreate = {
  resourceType: 'table' as const,
  userId: 'user-1',
  workspaceId: 'ws-1',
  name: 'Reports',
}

beforeEach(() => {
  resetDbChainMock()
  setConfig()
  mockWouldCreateFolderCycle.mockResolvedValue(false)
  mockAssertFolderCollectionHasRoom.mockResolvedValue(undefined)
  mockLoadActiveFolderPathIndex.mockResolvedValue({
    rowById: new Map(),
    pathById: new Map(),
    idByPath: new Map(),
  })
  mockDeduplicateFolderName.mockImplementation(
    async (_tx: unknown, _ws: string, _parent: string | null, name: string) => name
  )
  mockGetWorkspaceWithOwner.mockResolvedValue({ id: 'ws-1', archivedAt: null })
  mockCollectCascadeSubtreeIds.mockResolvedValue(['folder-1'])
  mockCollectArchivedSubtreeIds.mockResolvedValue(['folder-1'])
  mockArchiveFolderCascade.mockResolvedValue({ folders: 1, children: 0 })
  mockRestoreFolderRows.mockResolvedValue(1)
  mockRestoreFolderChildren.mockResolvedValue(0)
})

afterAll(() => {
  resetDbChainMock()
})

describe('createFolder', () => {
  it('refuses a parent that does not exist', async () => {
    queueTableRows(schemaMock.folder, [])

    const result = await createFolder({ ...baseCreate, parentId: 'missing' })

    expect(result).toEqual({
      success: false,
      error: 'Parent folder not found',
      errorCode: 'validation',
    })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('refuses a parent that belongs to another workspace', async () => {
    // The parent row exists and matches the resourceType, so only the workspace check stands
    // between a caller-supplied id and filing a folder under another tenant's tree.
    queueTableRows(schemaMock.folder, [{ workspaceId: 'ws-other', archivedAt: null }])

    const result = await createFolder({ ...baseCreate, parentId: 'parent-1' })

    expect(result.errorCode).toBe('validation')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('refuses an archived parent so a folder cannot be created inside a deleted tree', async () => {
    queueTableRows(schemaMock.folder, [{ workspaceId: 'ws-1', archivedAt: ARCHIVED_AT }])

    const result = await createFolder({ ...baseCreate, parentId: 'parent-1' })

    expect(result.errorCode).toBe('validation')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('refuses a folder that names itself as its own parent', async () => {
    const result = await createFolder({ ...baseCreate, id: 'folder-1', parentId: 'folder-1' })

    expect(result).toEqual({
      success: false,
      error: 'Folder cannot be its own parent',
      errorCode: 'validation',
    })
    // Rejected before any read, so a self-parented id never reaches the parent lookup.
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('returns a conflict on a duplicate sibling name instead of silently renaming', async () => {
    // Create is a path where the user chose the name, so the active-name unique index must
    // surface as a 409 they can act on — deduplicating here would hand back a folder the
    // user never asked for.
    queueTableRows(schemaMock.folder, [{ minSortOrder: 0 }])
    dbChainMockFns.returning.mockRejectedValueOnce(uniqueViolation())

    const result = await createFolder(baseCreate)

    expect(result).toEqual({
      success: false,
      error: DUPLICATE_NAME_ERROR,
      errorCode: 'conflict',
    })
  })

  /**
   * The writer must agree with the bounded readers: without this the sidebar
   * create path could push a workspace past `MAX_FOLDERS_PER_WORKSPACE`, after
   * which every capped read fails on a state the product allowed to exist.
   */
  it('refuses a create at the collection ceiling with a typed conflict, before inserting', async () => {
    mockAssertFolderCollectionHasRoom.mockRejectedValueOnce(
      new FolderCollectionFullError('table', 10_000)
    )

    const result = await createFolder(baseCreate)

    expect(result).toEqual({
      success: false,
      error:
        'This workspace has reached its limit of 10,000 table folders. Delete folders you no longer need before creating another one.',
      errorCode: 'conflict',
    })
    expect(folderMutationStatus(result.errorCode)).toBe(409)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('path-owned folder mutations', () => {
  it('returns a typed limit failure before expanding an oversized mutation index', async () => {
    mockLoadActiveFolderPathIndex.mockRejectedValueOnce(
      new FolderCollectionLimitExceededError('path index', 10_000)
    )

    const result = await createFolderAtPathTransition({
      resourceType: 'workflow',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
      maxFolderRows: 10_000,
    })

    expect(result).toEqual({
      success: false,
      error: 'Folder path index exceeds the 10000 row limit',
      errorCode: 'payload_too_large',
    })
    // A collection too large to materialize is an infrastructure limit, not a fault.
    expect(folderMutationStatus(result.errorCode)).toBe(413)
    expect(mockLoadActiveFolderPathIndex).toHaveBeenCalledWith(
      'ws-1',
      'workflow',
      expect.anything(),
      { maxRows: 10_000 }
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('releases the folder transaction before running the domain delete cascade', async () => {
    const source = folderRow({ id: 'folder-1', name: 'Reports' })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([['folder-1', source]]),
      pathById: new Map([['folder-1', '/Reports']]),
      idByPath: new Map([['/Reports', 'folder-1']]),
    })
    queueTableRows(schemaMock.folder, [{ deletedAt: null }])

    let inFolderTransaction = false
    dbChainMockFns.transaction.mockImplementationOnce(
      async (operation: (tx: unknown) => Promise<unknown>) => {
        inFolderTransaction = true
        try {
          return await operation(dbChainMock.db)
        } finally {
          inFolderTransaction = false
        }
      }
    )
    mockArchiveFolderCascade.mockImplementationOnce(async () => {
      expect(inFolderTransaction).toBe(false)
      return { folders: 1, children: 0 }
    })

    const result = await deleteFolderByPath({
      resourceType: 'table',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
      recursive: true,
    })

    expect(result).toMatchObject({ success: true, path: '/Reports' })
  })

  it('rejects relocating a folder beneath its own descendant before writing', async () => {
    const source = folderRow({ id: 'folder-1', name: 'Reports' })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([['folder-1', source]]),
      pathById: new Map([['folder-1', '/Reports']]),
      idByPath: new Map([['/Reports', 'folder-1']]),
    })

    const result = await relocateFolderByPath({
      resourceType: 'table',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
      destinationPath: '/Reports/Archive',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  /**
   * `/` is the one destination that always names an existing folder, so it
   * takes the source as a child like any other: the nested folder lands at the
   * top level under its own name. Before this the root was refused outright,
   * which left no way to move a folder back out of its parent.
   */
  it('moves a nested folder back to the root when the destination is /', async () => {
    const archive = folderRow({ id: 'folder-2', name: 'fx-archive' })
    const source = folderRow({ id: 'folder-1', name: 'xp-docs', parentId: 'folder-2' })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([
        ['folder-1', source],
        ['folder-2', archive],
      ]),
      pathById: new Map([
        ['folder-1', '/fx-archive/xp-docs'],
        ['folder-2', '/fx-archive'],
      ]),
      idByPath: new Map([
        ['/fx-archive/xp-docs', 'folder-1'],
        ['/fx-archive', 'folder-2'],
      ]),
    })
    dbChainMockFns.returning.mockResolvedValueOnce([
      folderRow({ id: 'folder-1', name: 'xp-docs', parentId: null }),
    ])

    const result = await relocateFolderByPath({
      resourceType: 'table',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/fx-archive/xp-docs',
      destinationPath: '/',
    })

    expect(result).toMatchObject({ success: true, path: '/xp-docs' })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'xp-docs', parentId: null })
    )
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Moved table folder to "/xp-docs"' })
    )
  })

  it('still refuses a move whose source already exists under the destination', async () => {
    const source = folderRow({ id: 'folder-1', name: 'xp-files' })
    const archive = folderRow({ id: 'folder-2', name: 'fx-archive' })
    const taken = folderRow({ id: 'folder-3', name: 'xp-files', parentId: 'folder-2' })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([
        ['folder-1', source],
        ['folder-2', archive],
        ['folder-3', taken],
      ]),
      pathById: new Map([
        ['folder-1', '/xp-files'],
        ['folder-2', '/fx-archive'],
        ['folder-3', '/fx-archive/xp-files'],
      ]),
      idByPath: new Map([
        ['/xp-files', 'folder-1'],
        ['/fx-archive', 'folder-2'],
        ['/fx-archive/xp-files', 'folder-3'],
      ]),
    })

    const result = await relocateFolderByPath({
      resourceType: 'table',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/xp-files',
      destinationPath: '/fx-archive',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires recursive deletion when the path has descendant folders', async () => {
    const source = folderRow({ id: 'folder-1', name: 'Reports' })
    const child = folderRow({ id: 'folder-2', name: 'Q1', parentId: 'folder-1' })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([
        ['folder-1', source],
        ['folder-2', child],
      ]),
      pathById: new Map([
        ['folder-1', '/Reports'],
        ['folder-2', '/Reports/Q1'],
      ]),
      idByPath: new Map([
        ['/Reports', 'folder-1'],
        ['/Reports/Q1', 'folder-2'],
      ]),
    })

    const result = await deleteFolderByPath({
      resourceType: 'table',
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
      recursive: false,
    })

    expect(result).toEqual({
      success: false,
      error: 'Folder is not empty',
      errorCode: 'conflict',
    })
    expect(mockArchiveFolderCascade).not.toHaveBeenCalled()
  })
})

describe('updateFolder', () => {
  const baseUpdate = {
    resourceType: 'table' as const,
    folderId: 'folder-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
  }

  it('refuses an archived folder, so a delete cannot unlock its locked subfolders', async () => {
    /**
     * `getFolderLockStatus` skips archived rows, so an archived-but-locked folder reports
     * unlocked. Without the `deletedAt IS NULL` predicate in the UPDATE, deleting a parent
     * would make every locked subfolder under it freely renameable and reparentable.
     */
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await updateFolder({ ...baseUpdate, name: 'Renamed' })

    expect(result).toMatchObject({ success: false, errorCode: 'not_found' })
    expect(dbChainMockFns.set).toHaveBeenCalled()
  })

  it('drops a locked flag on a resource type without lock semantics', async () => {
    // The engine is reachable from the copilot tools as well as the route, so a `locked`
    // value on an unlockable tree must never reach the row.
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow()])

    await updateFolder({ ...baseUpdate, locked: true })

    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set).not.toHaveProperty('locked')
  })

  it('refuses a reparent that would close a cycle', async () => {
    // A folder moved under its own descendant disappears from every tree walk, taking its
    // whole subtree with it.
    queueTableRows(schemaMock.folder, [{ workspaceId: 'ws-1', archivedAt: null }])
    mockWouldCreateFolderCycle.mockResolvedValueOnce(true)

    const result = await updateFolder({ ...baseUpdate, parentId: 'descendant-1' })

    expect(result).toEqual({
      success: false,
      error: 'Cannot create circular folder reference',
      errorCode: 'validation',
    })
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('reports a folder outside this workspace or resourceType as not found', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await updateFolder({ ...baseUpdate, name: 'Renamed' })

    expect(result).toEqual({
      success: false,
      error: 'Folder not found',
      errorCode: 'not_found',
    })
  })
})

describe('deleteFolder', () => {
  const baseDelete = {
    resourceType: 'table' as const,
    folderId: 'folder-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    folderName: 'Reports',
  }

  it('archives the resolved subtree and reports counts under the resource’s own key', async () => {
    queueTableRows(schemaMock.folder, [{ deletedAt: null }])
    mockCollectCascadeSubtreeIds.mockResolvedValueOnce(['folder-1', 'sub-1'])
    mockArchiveFolderCascade.mockResolvedValueOnce({ folders: 2, children: 3 })

    const result = await deleteFolder(baseDelete)

    expect(result).toEqual({ success: true, deletedItems: { folders: 2, tables: 3 } })
    expect(mockArchiveFolderCascade).toHaveBeenCalledWith(
      dbChainMock.db,
      resourceConfig.current,
      'ws-1',
      ['folder-1', 'sub-1'],
      expect.any(Date)
    )
  })

  it('refuses the delete whole when the resource’s guard rejects it', async () => {
    // Tables refuse deletion while delete-locked; deleting the folder around one must not
    // become a way around that control, and must not archive half the subtree first.
    setConfig({ guardDelete: mockGuardDelete })
    mockGuardDelete.mockResolvedValueOnce({
      error: 'Cannot delete folder: table Ledger is delete-locked',
      errorCode: 'locked',
    })
    queueTableRows(schemaMock.folder, [{ deletedAt: null }])

    const result = await deleteFolder(baseDelete)

    expect(result).toEqual({
      success: false,
      error: 'Cannot delete folder: table Ledger is delete-locked',
      errorCode: 'locked',
    })
    expect(mockArchiveFolderCascade).not.toHaveBeenCalled()
  })

  it('hands the guard the whole resolved subtree, not just the root', async () => {
    setConfig({ guardDelete: mockGuardDelete })
    mockGuardDelete.mockResolvedValueOnce(null)
    mockCollectCascadeSubtreeIds.mockResolvedValueOnce(['folder-1', 'sub-1'])
    queueTableRows(schemaMock.folder, [{ deletedAt: null }])

    await deleteFolder(baseDelete)

    expect(mockGuardDelete).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderIds: ['folder-1', 'sub-1'],
    })
  })

  it('reuses an already-archived folder’s timestamp so a retry rejoins the same snapshot', async () => {
    // A fresh stamp would be unrecoverable: the folder row keeps its original deletedAt, so
    // anything archived under the new stamp would never match on restore.
    queueTableRows(schemaMock.folder, [{ deletedAt: ARCHIVED_AT }])

    await deleteFolder(baseDelete)

    expect(mockCollectCascadeSubtreeIds).toHaveBeenCalledWith(
      dbChainMock.db,
      'ws-1',
      'table',
      'folder-1',
      ARCHIVED_AT
    )
    expect(mockArchiveFolderCascade).toHaveBeenCalledWith(
      dbChainMock.db,
      resourceConfig.current,
      'ws-1',
      ['folder-1'],
      ARCHIVED_AT
    )
  })
})

describe('restoreFolder', () => {
  const baseRestore = {
    resourceType: 'table' as const,
    folderId: 'folder-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
  }

  it('refuses to restore into an archived workspace', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({ id: 'ws-1', archivedAt: ARCHIVED_AT })

    const result = await restoreFolder(baseRestore)

    expect(result).toEqual({
      success: false,
      error: 'Cannot restore folder into an archived workspace',
      errorCode: 'validation',
    })
    expect(mockRestoreFolderRows).not.toHaveBeenCalled()
  })

  it('re-roots a folder whose original parent is still archived', async () => {
    // Restoring it under an archived parent would revive a row that no tree walk reaches —
    // visible in no list, restorable by nothing.
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT, parentId: 'parent-1' })])
    queueTableRows(schemaMock.folder, [{ archivedAt: ARCHIVED_AT }])

    const result = await restoreFolder(baseRestore)

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ parentId: null })
    // The name must then be checked against the ROOT's siblings, not the old parent's.
    expect(mockDeduplicateFolderName).toHaveBeenCalledWith(
      dbChainMock.db,
      'ws-1',
      null,
      'Reports',
      'table'
    )
  })

  it('renames rather than 409s when the folder’s name was taken while it was gone', async () => {
    // The caller cannot rename an archived folder, so a taken name would otherwise make it
    // permanently unrestorable.
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])
    mockDeduplicateFolderName.mockResolvedValueOnce('Reports (1)')

    const result = await restoreFolder(baseRestore)

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ name: 'Reports (1)' })
  })

  it('restores only the rows archived under the folder’s own timestamp', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])
    mockCollectArchivedSubtreeIds.mockResolvedValueOnce(['folder-1', 'sub-1'])
    mockRestoreFolderRows.mockResolvedValueOnce(2)
    mockRestoreFolderChildren.mockResolvedValueOnce(4)

    const result = await restoreFolder(baseRestore)

    expect(result).toEqual({ success: true, restoredItems: { folders: 2, tables: 4 } })
    expect(mockCollectArchivedSubtreeIds).toHaveBeenCalledWith(
      dbChainMock.db,
      'ws-1',
      'table',
      'folder-1',
      ARCHIVED_AT
    )
    expect(mockRestoreFolderRows).toHaveBeenCalledWith(
      dbChainMock.db,
      resourceConfig.current,
      'ws-1',
      ['folder-1', 'sub-1'],
      ARCHIVED_AT,
      expect.any(Date)
    )
  })

  it('runs a restoreChildren hook before the folder rows come back', async () => {
    // The hook opens its own transactions, so it cannot run nested — and going first is what
    // keeps a partial failure retryable: the folder stays archived until the children are back.
    setConfig({ restoreChildren: mockRestoreChildren })
    mockRestoreChildren.mockResolvedValueOnce(5)
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])

    const result = await restoreFolder(baseRestore)

    expect(mockRestoreChildren).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderIds: ['folder-1'],
      timestamp: ARCHIVED_AT,
    })
    expect(mockRestoreChildren.mock.invocationCallOrder[0]).toBeLessThan(
      mockRestoreFolderRows.mock.invocationCallOrder[0]
    )
    // The hook's count wins; the generic child restore never runs for this resource.
    expect(mockRestoreFolderChildren).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, restoredItems: { folders: 1, tables: 5 } })
  })

  it('returns a conflict when a concurrent create takes the name after the dedup check', async () => {
    // Dedup covers the restore root, but clearing deletedAt brings the row back under the
    // active-name unique index and that window is real.
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])
    mockRestoreFolderRows.mockRejectedValueOnce(uniqueViolation())

    const result = await restoreFolder(baseRestore)

    expect(result).toEqual({
      success: false,
      error: DUPLICATE_NAME_ERROR,
      errorCode: 'conflict',
    })
  })
})
