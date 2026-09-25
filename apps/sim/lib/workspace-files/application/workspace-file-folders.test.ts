import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  events,
  mockLoadContext,
  mockResolvePermission,
  mockAssertItems,
  mockArchive,
  mockCreate,
  mockDeleteByPath,
  mockEnsure,
  mockList,
  mockGetFolderPath,
  mockRelocate,
  mockRestore,
  mockAudit,
  mockNotify,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockLoadContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockAssertItems: vi.fn(),
  mockArchive: vi.fn(),
  mockCreate: vi.fn(),
  mockDeleteByPath: vi.fn(),
  mockEnsure: vi.fn(),
  mockList: vi.fn(),
  mockGetFolderPath: vi.fn(),
  mockRelocate: vi.fn(),
  mockRestore: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAssertItems,
  bulkArchiveWorkspaceFileItems: mockArchive,
  createWorkspaceFileFolderAtPath: mockCreate,
  deleteWorkspaceFileFolderByPath: mockDeleteByPath,
  ensureWorkspaceFileFolderPath: mockEnsure,
  listWorkspaceFileFolders: mockList,
  getWorkspaceFileFolderPath: mockGetFolderPath,
  loadWorkspaceFileOperationContext: mockLoadContext,
  relocateWorkspaceFileFolderByPath: mockRelocate,
  restoreWorkspaceFileFolder: mockRestore,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    FOLDER_CREATED: 'folder.created',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
    FOLDER_RESTORED: 'folder.restored',
  },
  AuditResourceType: { FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import {
  createWorkspaceFileFolderOperation,
  ensureWorkspaceFileFolderPathOperation,
  listWorkspaceFileFoldersOperation,
  resolveWorkspaceFileFolderPathOperation,
  restoreWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

const folder = {
  id: 'folder-1',
  workspaceId: 'ws-1',
  userId: 'owner-1',
  name: 'Reports',
  parentId: null,
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('workspace file folder operations', () => {
  beforeEach(() => {
    events.length = 0
    mockLoadContext.mockImplementation(async () => {
      events.push('resolve')
      return {
        workspaceId: 'ws-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'owner-1',
      }
    })
    mockResolvePermission.mockImplementation(async () => {
      events.push('authorize')
      return 'write'
    })
    mockAssertItems.mockResolvedValue(undefined)
    mockArchive.mockResolvedValue({ files: 0, folders: 1, fileIds: [], folderIds: ['folder-1'] })
  })

  it('resolves a Copilot folder pointer after authorization without listing every folder', async () => {
    mockGetFolderPath.mockImplementation(async () => {
      events.push('read-path')
      return 'Reports/Quarterly'
    })
    const result = await resolveWorkspaceFileFolderPathOperation.execute({
      principal: createCopilotChatFilePrincipal({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }),
      input: { workspaceId: 'ws-1', folderId: 'folder-1' },
    })
    expect(result.path).toBe('Reports/Quarterly')
    expect(events.indexOf('authorize')).toBeLessThan(events.indexOf('read-path'))
    expect(mockGetFolderPath).toHaveBeenCalledWith('ws-1', 'folder-1')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('refuses a folder pointer after the Copilot user loses workspace access', async () => {
    mockResolvePermission.mockResolvedValue(null)
    await expect(
      resolveWorkspaceFileFolderPathOperation.execute({
        principal: createCopilotChatFilePrincipal({ userId: 'user-1', workspaceId: 'ws-1' }),
        input: { workspaceId: 'ws-1', folderId: 'folder-1' },
      })
    ).rejects.toThrow()
    expect(mockGetFolderPath).not.toHaveBeenCalled()
  })

  const LEAF = {
    folder: {
      id: 'folder-c',
      name: 'C',
      path: 'A/B/C',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    path: 'A/B/C',
  }

  /*
   * The tool description promises "Parent folders are created as needed", and
   * the manager throws "Parent folder not found" when they are not — so a
   * missing ancestor is materialized and the create retried. Only the
   * ancestors: the leaf keeps its own call so it still audits and still
   * conflicts when something is already there.
   */
  it('materializes missing ancestors and retries the leaf', async () => {
    mockEnsure.mockResolvedValue({
      folderId: 'folder-b',
      createdFolderIds: ['folder-a', 'folder-b'],
    })
    mockCreate
      .mockRejectedValueOnce(new OrchestrationError('not_found', 'Parent folder not found'))
      .mockResolvedValue(LEAF)

    await createWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', path: '/A/B/C' },
    })

    expect(mockEnsure).toHaveBeenCalledWith(expect.objectContaining({ pathSegments: ['A', 'B'] }))
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['leaves the sort unset so the repository keeps its position ordering', {}, undefined],
    ['delegates an explicit sort', { sortBy: 'name', sortOrder: 'desc' } as const, 'name'],
  ])('%s', async (_label, sortInput, expectedSortBy) => {
    mockList.mockResolvedValue([folder])

    await listWorkspaceFileFoldersOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', ...sortInput },
    })

    expect(mockList).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ sortBy: expectedSortBy })
    )
  })

  it('matches a canonical encoded parent path against decoded stored folder paths', async () => {
    mockList.mockResolvedValue([
      { ...folder, id: 'child-1', name: 'Q1', path: 'Reports & Plans/Q1' },
      { ...folder, id: 'other-1', name: 'Other', path: 'Archive/Other' },
    ])

    const result = await listWorkspaceFileFoldersOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', parentPath: '/Reports%20%26%20Plans' },
    })

    expect(result.folders.map((item) => item.id)).toEqual(['child-1'])
  })

  describe('recursive listing', () => {
    const tree = [
      { ...folder, id: 'reports', name: 'Reports', path: 'Reports' },
      { ...folder, id: 'q3', name: 'Q3', path: 'Reports/Q3' },
      { ...folder, id: 'draft', name: 'Draft', path: 'Reports/Q3/Draft' },
      { ...folder, id: 'reportsx', name: 'Reportsx', path: 'Reportsx' },
    ]

    const list = (input: Record<string, unknown>) =>
      listWorkspaceFileFoldersOperation.execute({
        principal: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', ...input },
      })

    beforeEach(() => {
      mockList.mockResolvedValue(tree)
    })

    it('excludes a sibling whose name merely starts with the parent name', async () => {
      const result = await list({ parentPath: '/Reports', recursive: true })

      expect(result.folders.map((item) => item.id)).not.toContain('reportsx')
    })

    it('bounds the walk by depth', async () => {
      const result = await list({ parentPath: '/Reports', recursive: true, depth: 1 })

      expect(result.folders.map((item) => item.id)).toEqual(['q3'])
    })
  })

  it('ensures an entire decoded folder chain for a file write', async () => {
    mockEnsure.mockResolvedValue({
      folderId: 'nested-folder',
      createdFolderIds: ['reports-folder', 'nested-folder'],
    })

    const result = await ensureWorkspaceFileFolderPathOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', pathSegments: ['Reports', '2026'] },
    })

    expect(result.folderId).toBe('nested-folder')
    expect(result.createdFolderIds).toEqual(['reports-folder', 'nested-folder'])
    expect(mockEnsure).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      pathSegments: ['Reports', '2026'],
    })
  })

  /**
   * v2 addresses folders by path, and the folder being restored is archived, so
   * the id is resolved from the archived set rather than by walking the live
   * tree — which by definition would not contain it.
   */
  it('resolves an archived folder by path before restoring it', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'folder-other', name: 'Archive', path: 'Marketing/Archive' },
      { id: 'folder-target', name: 'Archive', path: 'Engineering/Archive' },
    ])
    mockRestore.mockResolvedValue({
      folder: { id: 'folder-target', name: 'Archive', path: 'Engineering/Archive' },
      restoredItems: { files: 3, folders: 1 },
    })

    await restoreWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', path: '/Engineering/Archive' },
    })

    expect(mockList).toHaveBeenCalledWith('ws-1', { scope: 'archived' })
    expect(mockRestore).toHaveBeenCalledWith('ws-1', 'folder-target')
  })

  it('does not restore a same-named archived folder under a different parent', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'folder-other', name: 'Archive', path: 'Marketing/Archive' },
    ])

    await expect(
      restoreWorkspaceFileFolderOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', path: '/Engineering/Archive' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('refuses to guess when two archived folders share the same path', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'folder-first', name: 'Archive', path: 'Engineering/Archive' },
      { id: 'folder-second', name: 'Archive', path: 'Engineering/Archive' },
    ])

    await expect(
      restoreWorkspaceFileFolderOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', path: '/Engineering/Archive' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('rejects restoring the workspace root', async () => {
    await expect(
      restoreWorkspaceFileFolderOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', path: '/' },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mockList).not.toHaveBeenCalled()
    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('does not authorize a folder restore as though its ID were a delegated file scope', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'ws-1',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      resourceScope: { fileId: 'folder-1' },
    }
    await expect(
      restoreWorkspaceFileFolderOperation.execute({
        principal,
        input: { workspaceId: 'ws-1', folderId: 'folder-1' },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockLoadContext).toHaveBeenCalledWith('ws-1')
    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockRestore).not.toHaveBeenCalled()
  })
})
