/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRows: vi.fn(),
  loadFolderIndex: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    FOLDER_CREATED: 'folder.created',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
    FOLDER_RESTORED: 'folder.restored',
  },
  AuditResourceType: { FOLDER: 'folder' },
  recordAudit: vi.fn(),
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

vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPathTransition: vi.fn(),
  deleteFolderByPathTransition: vi.fn(),
  relocateFolderByPathTransition: vi.fn(),
  restoreFolder: vi.fn(),
}))

vi.mock('@/lib/folders/queries', () => ({
  findArchivedFolderIdByPath: vi.fn(),
  listActiveFolderRows: mocks.listRows,
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))

import { restoreFolder } from '@/lib/folders/orchestration'
import { findArchivedFolderIdByPath } from '@/lib/folders/queries'
import { listTableFoldersUseCase, restoreTableFolderUseCase } from '@/lib/table/application/folders'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

describe('listTableFoldersUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'ws-1',
      billedAccountUserId: 'owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadFolderIndex.mockResolvedValue({
      idByPath: new Map([['/Reports', 'folder-1']]),
      pathById: new Map([['folder-1', '/Reports']]),
      rowById: new Map(),
    })
    mocks.listRows.mockResolvedValue([])
  })

  it('resolves a canonical parent path before listing', async () => {
    await listTableFoldersUseCase.execute({
      principal,
      input: { workspaceId: 'ws-1', parentPath: '/Reports' },
    })

    expect(mocks.listRows).toHaveBeenCalledWith(
      'ws-1',
      'table',
      expect.objectContaining({ parentId: 'folder-1' })
    )
  })

  /**
   * `parentPath` is a filter, so a path naming no active folder narrows the
   * result to nothing rather than reporting the collection missing. Falling
   * through to `listActiveFolderRows` with an undefined `parentId` would list
   * every folder in the workspace, so the miss has to short-circuit.
   */
  it('answers a parent path naming no folder with an empty page', async () => {
    const result = await listTableFoldersUseCase.execute({
      principal,
      input: { workspaceId: 'ws-1', parentPath: '/Missing' },
    })

    expect(result.folders).toEqual([])
    expect(mocks.listRows).not.toHaveBeenCalled()
  })
})

describe('restoreTableFolderUseCase', () => {
  const restoredRow = {
    id: 'folder-1',
    name: 'xp-explore-renamed',
    parentId: null,
    workspaceId: 'ws-1',
    resourceType: 'table',
    deletedAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'ws-1',
      billedAccountUserId: 'owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    vi.mocked(findArchivedFolderIdByPath).mockResolvedValue('folder-1')
    vi.mocked(restoreFolder).mockResolvedValue({
      success: true,
      restoredItems: { folders: 1, tables: 2 },
    })
    mocks.loadFolderIndex.mockResolvedValue({
      idByPath: new Map([['/xp-explore-renamed', 'folder-1']]),
      pathById: new Map([['folder-1', '/xp-explore-renamed']]),
      rowById: new Map([['folder-1', restoredRow]]),
    })
  })

  /**
   * The folder is addressed by the path it held when the recursive delete archived it, which
   * only an archived-aware lookup can resolve — the active index no longer knows it. The id
   * that lookup yields is what the orchestration restores; the path itself never reaches it.
   */
  it('restores the archived folder resolved from its delete-time path and reports what came back', async () => {
    const result = await restoreTableFolderUseCase.execute({
      principal,
      input: { workspaceId: 'ws-1', path: '/xp-explore-renamed' },
    })

    expect(findArchivedFolderIdByPath).toHaveBeenCalledWith(
      'ws-1',
      'table',
      '/xp-explore-renamed',
      expect.objectContaining({ maxRows: expect.any(Number) })
    )
    expect(restoreFolder).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'table', workspaceId: 'ws-1', folderId: 'folder-1' }),
      { projectAudit: false }
    )
    expect(result.folder).toBe(restoredRow)
    expect(result.restoredItems).toEqual({ folders: 1, tables: 2 })
    expect(result.requestedPath).toBe('/xp-explore-renamed')
  })

  it('reports a path no archived folder held as not found without touching the tree', async () => {
    vi.mocked(findArchivedFolderIdByPath).mockResolvedValue(null)

    await expect(
      restoreTableFolderUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', path: '/never-existed' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(restoreFolder).not.toHaveBeenCalled()
  })
})
