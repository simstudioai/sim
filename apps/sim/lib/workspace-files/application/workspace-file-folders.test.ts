/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  events,
  mockLoadContext,
  mockResolvePermission,
  mockAssertItems,
  mockArchive,
  mockCreate,
  mockEnsure,
  mockList,
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
  mockEnsure: vi.fn(),
  mockList: vi.fn(),
  mockRelocate: vi.fn(),
  mockRestore: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAssertItems,
  bulkArchiveWorkspaceFileItems: mockArchive,
  createWorkspaceFileFolderAtPath: mockCreate,
  ensureWorkspaceFileFolderPath: mockEnsure,
  listWorkspaceFileFolders: mockList,
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

import {
  createWorkspaceFileFolderOperation,
  deleteWorkspaceFileFolderOperation,
  ensureWorkspaceFileFolderPathOperation,
  listWorkspaceFileFoldersOperation,
  restoreWorkspaceFileFolderOperation,
  updateWorkspaceFileFolderOperation,
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
    vi.clearAllMocks()
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

  it('creates a canonical path folder through the manager primitive', async () => {
    mockCreate.mockImplementation(async () => {
      events.push('execute')
      return { folder, path: '/Reports' }
    })
    const result = await createWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', path: '/Reports' },
    })

    expect(result.folder.path).toBe('/Reports')
    expect(events).toEqual(['resolve', 'authorize', 'execute'])
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
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

  it('preserves the order the repository returned rather than re-sorting in memory', async () => {
    mockList.mockResolvedValue([
      { ...folder, id: 'newest', name: 'zeta' },
      { ...folder, id: 'middle', name: 'Alpha' },
      { ...folder, id: 'oldest', name: 'beta' },
    ])

    const result = await listWorkspaceFileFoldersOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1' },
    })

    expect(result.folders.map((item) => item.id)).toEqual(['newest', 'middle', 'oldest'])
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

  it('matches a parent whose name contains an escaped slash', async () => {
    mockList.mockResolvedValue([
      { ...folder, id: 'child-1', name: 'Q1', path: 'Finance\\/Legal/Q1' },
      { ...folder, id: 'other-1', name: 'Other', path: 'Finance/Legal/Other' },
    ])

    const result = await listWorkspaceFileFoldersOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', parentPath: '/Finance%2FLegal' },
    })

    expect(result.folders.map((item) => item.id)).toEqual(['child-1'])
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

  it('relocates a canonical path folder without invoking legacy orchestration', async () => {
    mockRelocate.mockResolvedValue({ folder, path: '/Archive/Reports' })
    const result = await updateWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'ws-1',
        path: '/Reports',
        destinationPath: '/Archive/Reports',
      },
    })

    expect(result.folder.path).toBe('/Archive/Reports')
    expect(mockRelocate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      path: '/Reports',
      destinationPath: '/Archive/Reports',
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('does not audit or notify when a folder archive updates no rows', async () => {
    mockArchive.mockResolvedValue({ files: 0, folders: 0, fileIds: [], folderIds: [] })

    await expect(
      deleteWorkspaceFileFolderOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', folderId: 'folder-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
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
