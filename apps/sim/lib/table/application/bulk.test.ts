/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  bulkDeleteFolders: vi.fn(),
  bulkMoveFolders: vi.fn(),
  deleteTable: vi.fn(),
  findActiveFolder: vi.fn(),
  moveTableToFolder: vi.fn(),
  planFolderSelection: vi.fn(),
  resolvePermission: vi.fn(),
  resolveTableContext: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  signal: vi.fn(),
  notifyTables: vi.fn(),
  resolveFolderPathFromIndex: vi.fn(),
  resolveTableFolderPath: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    TABLE_DELETED: 'table.deleted',
    TABLE_UPDATED: 'table.updated',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
  },
  AuditResourceType: { TABLE: 'table', FOLDER: 'folder' },
  recordAudit: mocks.audit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/folders/bulk', () => ({
  planFolderSelection: mocks.planFolderSelection,
  bulkMoveFolders: mocks.bulkMoveFolders,
  bulkDeleteFolders: mocks.bulkDeleteFolders,
  /** Pure projection — mirrored here rather than mocked, so outcomes stay realistic. */
  foldFolderPlan: (
    plan: { notFound: string[]; contained: { id: string; name: string }[] },
    outcome: {
      notFound: { kind: string; id: string }[]
      skipped: { kind: string; id: string; name: string }[]
    }
  ) => {
    for (const id of plan.notFound) outcome.notFound.push({ kind: 'folder', id })
    for (const folder of plan.contained) outcome.skipped.push({ kind: 'folder', ...folder })
  },
}))
vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceTablesChanged: mocks.notifyTables,
}))
vi.mock('@/lib/folders/queries', () => ({
  findActiveFolder: mocks.findActiveFolder,
  resolveFolderPathFromIndex: mocks.resolveFolderPathFromIndex,
}))
vi.mock('@/lib/table/application/folder-paths', () => ({
  resolveTableFolderPath: mocks.resolveTableFolderPath,
}))
vi.mock('@/lib/table', () => ({
  deleteTable: mocks.deleteTable,
  moveTableToFolder: mocks.moveTableToFolder,
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableInWorkspace: mocks.resolveTableContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { bulkDeleteTables, bulkMoveTables } from '@/lib/table/application/bulk'
import { TableLockedError } from '@/lib/table/mutation-locks'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

function tableContext(id: string, folderId: string | null = null) {
  return {
    ...workspaceContext,
    tableId: id,
    table: { id, name: `Table ${id}`, workspaceId: 'workspace-1', folderId },
  }
}

/**
 * The active folder tree a path-keyed batch resolves against. `undefined` for
 * anything absent, mirroring `resolveFolderPathFromIndex`; `/` is the workspace
 * root, which is not a folder row.
 */
const FOLDER_ID_BY_PATH: Record<string, string | null | undefined> = {
  '/': null,
  '/Sales': 'folder-1',
  '/Sales/': 'folder-1',
  '/Sales/Enterprise': 'folder-2',
}

const emptyPlan = { selected: [], notFound: [], contained: [], covered: new Set<string>() }

describe('table bulk application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.planFolderSelection.mockResolvedValue(emptyPlan)
    mocks.findActiveFolder.mockResolvedValue({ id: 'folder-1' })
    mocks.resolveTableContext.mockImplementation(async (tableId: string) => tableContext(tableId))
    mocks.moveTableToFolder.mockResolvedValue({ name: 'Moved' })
    mocks.deleteTable.mockResolvedValue({
      archived: { name: 'Archived', workspaceId: 'workspace-1' },
    })
    mocks.bulkMoveFolders.mockResolvedValue({ succeeded: [], failed: [] })
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [],
      failed: [],
      folderCount: 0,
      resourceCount: 0,
    })
    mocks.resolveTableFolderPath.mockResolvedValue({ folderId: null, index: { kind: 'index' } })
    mocks.resolveFolderPathFromIndex.mockImplementation(
      (_index: unknown, path: string) => FOLDER_ID_BY_PATH[path]
    )
  })

  it('rejects an empty selection before the canonical workspace load', async () => {
    await expect(
      bulkDeleteTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          folderKeying: 'ids' as const,
          tableIds: [],
          folders: [],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.deleteTable).not.toHaveBeenCalled()
  })

  it('bounds tables and folders against one combined cap', async () => {
    await expect(
      bulkDeleteTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          tableIds: Array.from({ length: 60 }, (_, index) => `table-${index}`),
          folderKeying: 'ids' as const,
          folders: Array.from({ length: 60 }, (_, index) => `folder-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
  })

  it('deletes tables and folders in one operation and audits every affected item', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Reports' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-1']),
    })
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Reports' }],
      failed: [],
      folderCount: 2,
      resourceCount: 5,
    })

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-1'],
        folderKeying: 'ids' as const,
        folders: ['folder-1'],
      },
    })

    expect(result.deleted).toEqual([
      { kind: 'table', id: 'table-1', name: 'Archived' },
      { kind: 'folder', id: 'folder-1', name: 'Reports' },
    ])
    expect(result.deletedItems).toEqual({ tables: 6, folders: 2 })
    expect(mocks.audit).toHaveBeenCalledTimes(2)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'table.deleted', resourceId: 'table-1' })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'folder.deleted', resourceId: 'folder-1' })
    )
  })

  /**
   * The whole point of taking both id lists in one request: a table that is
   * also inside a selected folder must be archived exactly once, under the
   * folder's cascade timestamp, or the folder's restore could never recover it.
   */
  it('skips a table that a selected folder already carries', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Reports' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-1', 'folder-child']),
    })
    mocks.resolveTableContext.mockImplementation(async (tableId: string) =>
      tableContext(tableId, 'folder-child')
    )

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-1'],
        folderKeying: 'ids' as const,
        folders: ['folder-1'],
      },
    })

    expect(result.skipped).toEqual([{ kind: 'table', id: 'table-1', name: 'Table table-1' }])
    expect(mocks.deleteTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'table.deleted' })
    )
  })

  it('reports a locked table as a per-item failure without stranding the rest', async () => {
    mocks.deleteTable.mockImplementation(async (tableId: string) => {
      if (tableId === 'table-locked') throw new TableLockedError('delete')
      return { archived: { name: 'Archived', workspaceId: 'workspace-1' } }
    })

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-locked', 'table-2'],
        folderKeying: 'ids' as const,
        folders: [],
      },
    })

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ kind: 'table', id: 'table-locked' })
    expect(result.deleted).toEqual([{ kind: 'table', id: 'table-2', name: 'Archived' }])
  })

  it('conceals an inaccessible table as not-found rather than naming it', async () => {
    mocks.resolveTableContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Table not found')
    )

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'ids' as const,
        tableIds: ['other-workspace'],
        folders: [],
      },
    })

    expect(result.notFound).toEqual([{ kind: 'table', id: 'other-workspace' }])
    expect(result.failed).toEqual([])
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('fails the whole move when the destination folder is not in the workspace', async () => {
    mocks.findActiveFolder.mockResolvedValue(null)

    await expect(
      bulkMoveTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          tableIds: ['table-1'],
          folderKeying: 'ids' as const,
          folders: [],
          targetFolder: 'foreign-folder',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.moveTableToFolder).not.toHaveBeenCalled()
  })

  it('fails the whole move when the destination sits inside the moving subtree', async () => {
    // `covered` is the selected folders plus their descendants. Without an up-front check the
    // tables move, the folders then fail their own cycle check, and the caller is left with a
    // half-applied selection.
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-2', name: 'Archive' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-2', 'folder-2-child']),
    })

    for (const targetFolder of ['folder-2', 'folder-2-child']) {
      await expect(
        bulkMoveTables.execute({
          principal,
          input: {
            assertedWorkspaceId: 'workspace-1',
            tableIds: ['table-1'],
            folderKeying: 'ids' as const,
            folders: ['folder-2'],
            targetFolder,
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }

    expect(mocks.moveTableToFolder).not.toHaveBeenCalled()
    expect(mocks.bulkMoveFolders).not.toHaveBeenCalled()
  })

  /**
   * The canonical workspace context is what bounded and authorized the request; it cannot differ
   * per item, so the batch resolves it once and composes each table onto it. Resolving it per
   * item was a whole extra load each.
   *
   * Note this deliberately does NOT memoize the per-item permission check: each item commits
   * independently, so every one of them re-reads the caller's current permission and a
   * revocation part-way through a batch stops the rest.
   */
  it('loads the workspace context once however many items the batch carries', async () => {
    const move = (tableIds: string[]) =>
      bulkMoveTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          tableIds,
          folderKeying: 'ids' as const,
          folders: [],
          targetFolder: 'folder-1',
        },
      })

    const small = await move(['table-1', 'table-2', 'table-3'])
    expect(small.moved).toHaveLength(3)
    expect(mocks.resolveWorkspaceContext).toHaveBeenCalledTimes(1)

    mocks.resolveWorkspaceContext.mockClear()
    const large = await move(Array.from({ length: 25 }, (_, index) => `table-${index}`))
    expect(large.moved).toHaveLength(25)
    expect(mocks.resolveWorkspaceContext).toHaveBeenCalledTimes(1)
  })

  /** A revocation part-way through a batch must stop the items that have not run yet. */
  it('re-checks the caller permission for every item', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('write').mockResolvedValueOnce('write')
    mocks.resolvePermission.mockResolvedValue(null)

    const result = await bulkMoveTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-1', 'table-2', 'table-3'],
        folderKeying: 'ids' as const,
        folders: [],
        targetFolder: 'folder-1',
      },
    })

    expect(result.moved).toHaveLength(1)
    expect(result.failed.concat(result.notFound as never[])).toHaveLength(2)
    /** One for the operation itself, then one per item — no memo may collapse these. */
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(4)
  })

  it('moves tables and folders in one operation', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-2', name: 'Archive' }],
      notFound: ['ghost-folder'],
      contained: [{ id: 'folder-3', name: 'Nested' }],
      covered: new Set(['folder-2', 'folder-3']),
    })
    mocks.bulkMoveFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-2', name: 'Archive' }],
      failed: [],
    })

    const result = await bulkMoveTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-1'],
        folderKeying: 'ids' as const,
        folders: ['folder-2', 'folder-3', 'ghost-folder'],
        targetFolder: 'folder-1',
      },
    })

    expect(result.moved).toEqual([
      { kind: 'table', id: 'table-1', name: 'Moved' },
      { kind: 'folder', id: 'folder-2', name: 'Archive' },
    ])
    expect(result.skipped).toEqual([{ kind: 'folder', id: 'folder-3', name: 'Nested' }])
    expect(result.notFound).toEqual([{ kind: 'folder', id: 'ghost-folder' }])
    expect(mocks.bulkMoveFolders).toHaveBeenCalledWith(
      expect.objectContaining({ targetParentId: 'folder-1' })
    )
    expect(mocks.signal).toHaveBeenCalledExactlyOnceWith('table-1')
  })

  /**
   * One gesture, one live-list broadcast. A per-item notify is an internal HTTP
   * round trip with an identical body, so a 100-item batch would otherwise make
   * every connected client refetch the same list 100 times.
   */
  it('suppresses the per-table notify and sends exactly one for the batch', async () => {
    await bulkMoveTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        tableIds: ['table-1', 'table-2', 'table-3'],
        folderKeying: 'ids' as const,
        folders: [],
        targetFolder: 'folder-1',
      },
    })

    expect(mocks.moveTableToFolder).toHaveBeenCalledTimes(3)
    for (const call of mocks.moveTableToFolder.mock.calls) {
      expect(call[4]).toEqual({ notify: false })
    }
    expect(mocks.notifyTables).toHaveBeenCalledExactlyOnceWith('workspace-1')
  })

  it('still notifies for the prefix a batch committed before it failed', async () => {
    mocks.deleteTable.mockImplementation(async (tableId: string) => {
      if (tableId === 'table-2') throw new Error('connection reset')
      return { archived: { name: 'Archived', workspaceId: 'workspace-1' } }
    })

    await expect(
      bulkDeleteTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          tableIds: ['table-1', 'table-2'],
          folderKeying: 'ids' as const,
          folders: [],
        },
      })
    ).rejects.toThrow('connection reset')

    expect(mocks.notifyTables).toHaveBeenCalledExactlyOnceWith('workspace-1')
  })

  it('sends no notify when the batch archived nothing', async () => {
    mocks.resolveTableContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Table not found')
    )

    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'ids' as const,
        tableIds: ['ghost'],
        folders: [],
      },
    })

    expect(mocks.notifyTables).not.toHaveBeenCalled()
  })

  it('records audit for the committed prefix before rethrowing an infrastructure failure', async () => {
    mocks.deleteTable.mockImplementation(async (tableId: string) => {
      if (tableId === 'table-2') throw new Error('connection reset')
      return { archived: { name: 'Archived', workspaceId: 'workspace-1' } }
    })

    await expect(
      bulkDeleteTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          tableIds: ['table-1', 'table-2', 'table-3'],
          folderKeying: 'ids' as const,
          folders: [],
        },
      })
    ).rejects.toThrow('connection reset')

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'table.deleted', resourceId: 'table-1' })
    )
    expect(mocks.bulkDeleteFolders).not.toHaveBeenCalled()
  })
})

/**
 * The v2 surface names folders by canonical path. Resolving one is an
 * authorization-sensitive read of the workspace's folder tree, so it happens
 * here rather than at a route — and everything the caller gets back is named
 * the same way it asked, never by an id it has no way to use.
 */
describe('path-keyed bulk table selections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.planFolderSelection.mockResolvedValue(emptyPlan)
    mocks.findActiveFolder.mockResolvedValue({ id: 'folder-1' })
    mocks.resolveTableContext.mockImplementation(async (tableId: string) => tableContext(tableId))
    mocks.moveTableToFolder.mockResolvedValue({ name: 'Moved' })
    mocks.deleteTable.mockResolvedValue({
      archived: { name: 'Archived', workspaceId: 'workspace-1' },
    })
    mocks.bulkMoveFolders.mockResolvedValue({ succeeded: [], failed: [] })
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [],
      failed: [],
      folderCount: 0,
      resourceCount: 0,
    })
    mocks.resolveTableFolderPath.mockResolvedValue({ folderId: null, index: { kind: 'index' } })
    mocks.resolveFolderPathFromIndex.mockImplementation(
      (_index: unknown, path: string) => FOLDER_ID_BY_PATH[path]
    )
  })

  it('resolves selected folder paths to canonical ids before planning', async () => {
    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales', '/Sales/Enterprise'],
      },
    })

    expect(mocks.planFolderSelection).toHaveBeenCalledWith('workspace-1', 'table', [
      'folder-1',
      'folder-2',
    ])
  })

  /**
   * The selection deduplicates PATHS, so two spellings of one folder survive it
   * and resolve to the same id. Left in, the batch carries that id twice while
   * the path index is last-wins, so one of the two spellings is unreportable.
   */
  it('deduplicates folders that two distinct paths resolve to', async () => {
    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales', '/Sales/'],
      },
    })

    expect(mocks.planFolderSelection).toHaveBeenCalledWith('workspace-1', 'table', ['folder-1'])
  })

  it('names a deduplicated folder by the first path that reached it', async () => {
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Sales' }],
      failed: [],
      folderCount: 1,
      resourceCount: 0,
    })
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Sales' }],
      notFound: [],
      contained: [],
      covered: new Set<string>(),
    })

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales', '/Sales/'],
      },
    })

    expect(result.deleted).toEqual([{ kind: 'folder', id: '/Sales', name: '/Sales' }])
  })

  /**
   * The published `deleted` is keyed the way the caller addressed the batch, so
   * on this route a folder's id is replaced by its display path. The audit must
   * not inherit that: `FOLDER_DELETED.resourceId` recorded `/Sales` here while
   * `DELETE /api/folders/[id]` recorded the canonical id for the same action,
   * leaving two spellings of one resource that no query could join.
   */
  it('audits a path-keyed folder deletion by its canonical id', async () => {
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Sales' }],
      failed: [],
      folderCount: 1,
      resourceCount: 0,
    })
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Sales' }],
      notFound: [],
      contained: [],
      covered: new Set<string>(),
    })

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales'],
      },
    })

    expect(result.deleted).toEqual([{ kind: 'folder', id: '/Sales', name: '/Sales' }])
    expect(result.auditedDeletions).toEqual([
      expect.objectContaining({ kind: 'folder', id: 'folder-1' }),
    ])
  })

  /**
   * The v2 audit formatter nulls `resourceId` for every folder row, so the leaf
   * name is all a v2 consumer would have left — and two folders named `dup` in
   * different trees produce byte-identical rows. The single-folder delete
   * records the path for the same reason.
   */
  it('records the folder path a path-keyed bulk delete named, as the single delete does', async () => {
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Sales' }],
      failed: [],
      folderCount: 1,
      resourceCount: 0,
    })
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Sales' }],
      notFound: [],
      contained: [],
      covered: new Set<string>(),
    })

    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales'],
      },
    })

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'folder.deleted',
        resourceId: 'folder-1',
        description: 'Deleted table folder "/Sales"',
        metadata: expect.objectContaining({ path: '/Sales' }),
      })
    )
  })

  /**
   * The id-keyed surface skips the folder-tree index read on purpose, so it has
   * no path to record. Pinned so a later change cannot quietly take that lock.
   */
  it('records no path for an id-keyed bulk delete', async () => {
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Sales' }],
      failed: [],
      folderCount: 1,
      resourceCount: 0,
    })
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Sales' }],
      notFound: [],
      contained: [],
      covered: new Set<string>(),
    })

    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'ids' as const,
        tableIds: [],
        folders: ['folder-1'],
      },
    })

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'folder.deleted',
        description: 'Deleted table folder "Sales"',
        metadata: expect.not.objectContaining({ path: expect.anything() }),
      })
    )
  })

  /**
   * One index for the whole batch: `resolveTableFolderPath` takes the folder
   * tree lock per call, so per-path resolution would be a lock acquisition each.
   */
  it('reads the folder tree once however many paths the batch names', async () => {
    await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales', '/Sales/Enterprise'],
      },
    })

    expect(mocks.resolveTableFolderPath).toHaveBeenCalledTimes(1)
  })

  it('reports a path naming no active folder as not found, without failing the batch', async () => {
    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: ['table-1'],
        folders: ['/Sales/Ghost'],
      },
    })

    expect(result.notFound).toEqual([{ kind: 'folder', id: '/Sales/Ghost' }])
    expect(result.deleted).toEqual([{ kind: 'table', id: 'table-1', name: 'Archived' }])
  })

  /** The workspace root is not a folder row, so it can be neither moved nor deleted. */
  it('reports the workspace root as not found rather than acting on it', async () => {
    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: ['table-1'],
        folders: ['/'],
      },
    })

    expect(result.notFound).toEqual([{ kind: 'folder', id: '/' }])
  })

  it('names every folder in the result by the path the caller used', async () => {
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Sales' }],
      failed: [],
      folderCount: 1,
      resourceCount: 3,
    })
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Sales' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-1']),
    })

    const result = await bulkDeleteTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: [],
        folders: ['/Sales'],
      },
    })

    expect(result.deleted).toEqual([{ kind: 'folder', id: '/Sales', name: '/Sales' }])
  })

  it('resolves the destination path and refuses one that names no folder', async () => {
    await bulkMoveTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: ['table-1'],
        folders: [],
        targetFolder: '/Sales',
      },
    })
    expect(mocks.moveTableToFolder).toHaveBeenCalledWith(
      'table-1',
      'workspace-1',
      'folder-1',
      'request-1',
      { notify: false }
    )

    await expect(
      bulkMoveTables.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          folderKeying: 'paths' as const,
          tableIds: ['table-1'],
          folders: [],
          targetFolder: '/Sales/Ghost',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('treats a null destination as the workspace root', async () => {
    await bulkMoveTables.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        folderKeying: 'paths' as const,
        tableIds: ['table-1'],
        folders: [],
        targetFolder: null,
      },
    })

    expect(mocks.moveTableToFolder).toHaveBeenCalledWith(
      'table-1',
      'workspace-1',
      null,
      'request-1',
      { notify: false }
    )
  })
})
