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

  /*
   * A recursive listing narrows in memory instead of in SQL: depth is a property
   * of the hierarchy, and the index already holds the whole active tree the
   * depths must be walked from. So the query drops its `parentId` filter and the
   * subtree is selected afterwards — a `parentId` left on would return only the
   * direct children and quietly cap every recursive listing at one level.
   */
  describe('recursive listing', () => {
    const TREE = [
      { id: 'folder-1', name: 'Reports', parentId: null },
      { id: 'folder-2', name: 'Q3', parentId: 'folder-1' },
      { id: 'folder-3', name: 'Drafts', parentId: 'folder-2' },
      { id: 'folder-4', name: 'Archive', parentId: null },
    ]

    beforeEach(() => {
      mocks.loadFolderIndex.mockResolvedValue({
        idByPath: new Map([
          ['/Reports', 'folder-1'],
          ['/Reports/Q3', 'folder-2'],
          ['/Reports/Q3/Drafts', 'folder-3'],
          ['/Archive', 'folder-4'],
        ]),
        pathById: new Map([
          ['folder-1', '/Reports'],
          ['folder-2', '/Reports/Q3'],
          ['folder-3', '/Reports/Q3/Drafts'],
          ['folder-4', '/Archive'],
        ]),
        rowById: new Map(TREE.map((row) => [row.id, row])),
      })
      mocks.listRows.mockResolvedValue(TREE)
    })

    it('queries the whole workspace and selects the subtree, with depths', async () => {
      const result = await listTableFoldersUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', parentPath: '/Reports', recursive: true },
      })

      expect(mocks.listRows).toHaveBeenCalledWith(
        'ws-1',
        'table',
        expect.objectContaining({ parentId: undefined })
      )
      expect(result.folders.map((row) => row.id)).toEqual(['folder-2', 'folder-3'])
      expect(result.depthById?.get('folder-2')).toBe(1)
      expect(result.depthById?.get('folder-3')).toBe(2)
    })

    it('stops at the requested depth', async () => {
      const result = await listTableFoldersUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', parentPath: '/Reports', recursive: true, maxDepth: 1 },
      })

      expect(result.folders.map((row) => row.id)).toEqual(['folder-2'])
    })

    it('walks from the workspace root when the parent is the root', async () => {
      const result = await listTableFoldersUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', parentPath: '/', recursive: true },
      })

      expect(result.folders.map((row) => row.id)).toEqual([
        'folder-1',
        'folder-2',
        'folder-3',
        'folder-4',
      ])
      expect(result.depthById?.get('folder-1')).toBe(1)
      expect(result.depthById?.get('folder-3')).toBe(3)
    })

    it('keeps a non-recursive listing on the SQL parent filter', async () => {
      const result = await listTableFoldersUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', parentPath: '/Reports' },
      })

      expect(mocks.listRows).toHaveBeenCalledWith(
        'ws-1',
        'table',
        expect.objectContaining({ parentId: 'folder-1' })
      )
      /* The query decided the rows; the walk only supplies their depth. */
      expect(result.folders).toEqual(TREE)
    })

    /*
     * Search filters the RESULT, not the traversal — a folder deep in the tree
     * whose ancestors do not match is still reported, at its real depth.
     */
    it('reports a deep match whose ancestors were filtered out of the query', async () => {
      mocks.listRows.mockResolvedValue([TREE[2]])

      const result = await listTableFoldersUseCase.execute({
        principal,
        input: { workspaceId: 'ws-1', parentPath: '/Reports', recursive: true, search: 'Drafts' },
      })

      expect(mocks.listRows).toHaveBeenCalledWith(
        'ws-1',
        'table',
        expect.objectContaining({ search: 'Drafts' })
      )
      expect(result.folders.map((row) => row.id)).toEqual(['folder-3'])
      expect(result.depthById?.get('folder-3')).toBe(2)
    })
  })
})
