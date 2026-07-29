/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/folders/queries', () => ({ wouldCreateFolderCycle: mockWouldCreateFolderCycle }))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import { createFolder, deleteFolder, restoreFolder, updateFolder } from '@/lib/folders/lifecycle'

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
  vi.clearAllMocks()
  resetDbChainMock()
  setConfig()
  mockWouldCreateFolderCycle.mockResolvedValue(false)
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
  it('inserts the trimmed name and returns the created row', async () => {
    queueTableRows(schemaMock.folder, [{ minSortOrder: 5 }])
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow()])

    const result = await createFolder({ ...baseCreate, id: 'folder-1', name: '  Reports  ' })

    expect(result).toEqual({ success: true, folder: folderRow() })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'folder-1',
        resourceType: 'table',
        name: 'Reports',
        workspaceId: 'ws-1',
        parentId: null,
      })
    )
  })

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

  it('scopes the parent lookup to the same resourceType so the DB trigger never has to', async () => {
    // `folder_parent_resource_type_match` enforces this too; skipping it here would surface a
    // raw trigger error as a 500 instead of a 400.
    queueTableRows(schemaMock.folder, [])

    await createFolder({ ...baseCreate, resourceType: 'knowledge_base', parentId: 'parent-1' })

    const [where] = dbChainMockFns.where.mock.calls[0] as [{ conditions: unknown[] }]
    expect(where.conditions).toContainEqual(expect.objectContaining({ right: 'knowledge_base' }))
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

  it('places a new folder above every existing sibling folder and resource', async () => {
    // Workflows interleave folders and rows in one ordering space, so the new folder has to
    // clear the minimum of BOTH — clearing only the folders would bury it under a workflow.
    setConfig({
      resourceType: 'workflow',
      countKey: 'workflows',
      sortOrderColumn: 'child.sortOrder',
    })
    queueTableRows(schemaMock.folder, [{ minSortOrder: 3 }])
    queueTableRows(CHILD_TABLE, [{ minSortOrder: -2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow({ sortOrder: -3 })])

    await createFolder({ ...baseCreate, resourceType: 'workflow' })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: -3 }))
  })

  it('starts at zero when the folder is the first thing in its location', async () => {
    queueTableRows(schemaMock.folder, [{ minSortOrder: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow()])

    await createFolder(baseCreate)

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 0 }))
  })

  it('honours an explicit sortOrder without querying siblings', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow({ sortOrder: 42 })])

    await createFolder({ ...baseCreate, sortOrder: 42 })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 42 }))
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

  it('reports any other insert failure as internal rather than a name conflict', async () => {
    queueTableRows(schemaMock.folder, [{ minSortOrder: 0 }])
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection reset'))

    const result = await createFolder(baseCreate)

    expect(result).toEqual({
      success: false,
      error: 'Internal server error',
      errorCode: 'internal',
    })
  })
})

describe('updateFolder', () => {
  const baseUpdate = {
    resourceType: 'table' as const,
    folderId: 'folder-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
  }

  it('writes only the fields the caller supplied, plus a fresh updatedAt', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow({ name: 'Renamed' })])

    const result = await updateFolder({ ...baseUpdate, name: '  Renamed  ' })

    expect(result.success).toBe(true)
    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set.name).toBe('Renamed')
    expect(set.updatedAt).toBeInstanceOf(Date)
    expect(set).not.toHaveProperty('parentId')
    expect(set).not.toHaveProperty('sortOrder')
  })

  it('reparents a folder under a validated parent', async () => {
    queueTableRows(schemaMock.folder, [{ workspaceId: 'ws-1', archivedAt: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow({ parentId: 'parent-1' })])

    const result = await updateFolder({ ...baseUpdate, parentId: 'parent-1' })

    expect(result.success).toBe(true)
    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set.parentId).toBe('parent-1')
  })

  it('clears the parent when reparenting to the root', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow()])

    await updateFolder({ ...baseUpdate, parentId: null })

    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set.parentId).toBeNull()
  })

  it('drops a locked flag on a resource type without lock semantics', async () => {
    // The engine is reachable from the copilot tools as well as the route, so a `locked`
    // value on an unlockable tree must never reach the row.
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow()])

    await updateFolder({ ...baseUpdate, locked: true })

    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set).not.toHaveProperty('locked')
  })

  it('persists a locked flag on the one resource type that supports locking', async () => {
    setConfig({ resourceType: 'workflow', countKey: 'workflows', supportsLocking: true })
    dbChainMockFns.returning.mockResolvedValueOnce([folderRow({ locked: true })])

    await updateFolder({ ...baseUpdate, resourceType: 'workflow', locked: true })

    const [set] = dbChainMockFns.set.mock.calls[0] as [Record<string, unknown>]
    expect(set.locked).toBe(true)
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

  it('refuses a folder that names itself as its own parent', async () => {
    const result = await updateFolder({ ...baseUpdate, parentId: 'folder-1' })

    expect(result).toEqual({
      success: false,
      error: 'Folder cannot be its own parent',
      errorCode: 'validation',
    })
    expect(mockWouldCreateFolderCycle).not.toHaveBeenCalled()
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

  it('returns a conflict when a rename collides with an active sibling', async () => {
    // Rename, like create, is a name the user chose — a 409 lets them pick another rather
    // than being handed "Reports (1)".
    dbChainMockFns.returning.mockRejectedValueOnce(uniqueViolation())

    const result = await updateFolder({ ...baseUpdate, name: 'Taken' })

    expect(result).toEqual({
      success: false,
      error: DUPLICATE_NAME_ERROR,
      errorCode: 'conflict',
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

  it('reports a folder outside this workspace or resourceType as not found', async () => {
    queueTableRows(schemaMock.folder, [])

    const result = await deleteFolder(baseDelete)

    expect(result).toEqual({
      success: false,
      error: 'Folder not found',
      errorCode: 'not_found',
    })
    expect(mockArchiveFolderCascade).not.toHaveBeenCalled()
  })

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

  it('resolves the timestamp before the subtree walk, which needs it to see stragglers', async () => {
    queueTableRows(schemaMock.folder, [{ deletedAt: ARCHIVED_AT }])

    await deleteFolder(baseDelete)

    const [, , , , walkTimestamp] = mockCollectCascadeSubtreeIds.mock.calls[0]
    const [, , , , archiveTimestamp] = mockArchiveFolderCascade.mock.calls[0]
    expect(walkTimestamp).toBe(archiveTimestamp)
  })
})

describe('restoreFolder', () => {
  const baseRestore = {
    resourceType: 'table' as const,
    folderId: 'folder-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
  }

  it('reports a folder outside this workspace or resourceType as not found', async () => {
    queueTableRows(schemaMock.folder, [])

    const result = await restoreFolder(baseRestore)

    expect(result).toEqual({
      success: false,
      error: 'Folder not found',
      errorCode: 'not_found',
    })
  })

  it('is a no-op on a folder that was never archived', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: null })])

    const result = await restoreFolder(baseRestore)

    expect(result).toEqual({ success: true, restoredItems: { folders: 0, tables: 0 } })
    expect(mockRestoreFolderRows).not.toHaveBeenCalled()
  })

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

  it('keeps a folder under its parent when that parent came back first', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT, parentId: 'parent-1' })])
    queueTableRows(schemaMock.folder, [{ archivedAt: null }])

    await restoreFolder(baseRestore)

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ parentId: null })
    expect(mockDeduplicateFolderName).toHaveBeenCalledWith(
      dbChainMock.db,
      'ws-1',
      'parent-1',
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

  it('leaves the name alone when nothing took it', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])

    await restoreFolder(baseRestore)

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.anything() })
    )
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

  it('rethrows any non-conflict failure instead of reporting a name collision', async () => {
    queueTableRows(schemaMock.folder, [folderRow({ deletedAt: ARCHIVED_AT })])
    mockRestoreFolderRows.mockRejectedValueOnce(new Error('connection reset'))

    await expect(restoreFolder(baseRestore)).rejects.toThrow('connection reset')
  })
})
