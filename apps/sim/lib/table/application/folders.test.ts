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

import { listTableFoldersUseCase } from '@/lib/table/application/folders'

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
