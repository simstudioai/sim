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
})
