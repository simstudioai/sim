import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { foldersOrchestrationMock } from '@sim/testing/mocks/folders-orchestration.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

import { relocateFolderByPathTransition, restoreFolder } from '@/lib/folders/orchestration'
import { findArchivedFolderIdByPath } from '@/lib/folders/queries'
import {
  listTableFoldersUseCase,
  restoreTableFolderUseCase,
  updateTableFolderUseCase,
} from '@/lib/table/application/folders'

const mocks = {
  listRows: folderQueriesMockFns.mockListActiveFolderRows,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  resolveWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()

describe('listTableFoldersUseCase', () => {
  beforeEach(() => {
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

describe('updateTableFolderUseCase', () => {
  beforeEach(() => {
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'ws-1',
      billedAccountUserId: 'owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadFolderIndex.mockResolvedValue({
      idByPath: new Map(),
      pathById: new Map(),
      rowById: new Map(),
    })
  })

  /**
   * `mv` semantics are decided in the shared orchestration, under its lock, so
   * the use case reports where the folder actually landed rather than echoing
   * the destination it was asked for.
   */
  it('reports the resolved path when the destination named an existing folder', async () => {
    const folder = { id: 'folder-1', name: 'xp-files', parentId: 'folder-2' }
    vi.mocked(relocateFolderByPathTransition).mockResolvedValue({
      success: true,
      folder,
      path: '/fx-archive/xp-files',
    } as never)

    const result = await updateTableFolderUseCase.execute({
      principal,
      input: { workspaceId: 'ws-1', path: '/xp-files', destinationPath: '/fx-archive' },
    })

    expect(relocateFolderByPathTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'table',
        path: '/xp-files',
        destinationPath: '/fx-archive',
      })
    )
    expect(result.path).toBe('/fx-archive/xp-files')
    expect(result.sourcePath).toBe('/xp-files')
    expect(result.folder).toBe(folder)
  })
})
