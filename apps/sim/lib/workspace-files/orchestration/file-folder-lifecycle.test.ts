/**
 * @vitest-environment node
 *
 * Failure classification. Every `perform*` here is consumed by a public v2 route
 * that maps `errorCode` straight to an HTTP status, so a manager failure that
 * arrives unclassified silently becomes a 500 for what is really a caller-fixable
 * 400 or 404. These pin the mapping rather than the happy paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMoveWorkspaceFileItems,
  mockUpdateWorkspaceFileFolder,
  mockCreateWorkspaceFileFolder,
  mockRestoreWorkspaceFileFolder,
  mockRenameWorkspaceFile,
  mockRestoreWorkspaceFile,
  mockBulkArchive,
  mockCreateWorkspaceFileFolderAtPath,
  mockRelocateWorkspaceFileFolderByPath,
  mockDeleteWorkspaceFileFolderByPath,
} = vi.hoisted(() => ({
  mockMoveWorkspaceFileItems: vi.fn(),
  mockUpdateWorkspaceFileFolder: vi.fn(),
  mockCreateWorkspaceFileFolder: vi.fn(),
  mockRestoreWorkspaceFileFolder: vi.fn(),
  mockRenameWorkspaceFile: vi.fn(),
  mockRestoreWorkspaceFile: vi.fn(),
  mockBulkArchive: vi.fn(),
  mockCreateWorkspaceFileFolderAtPath: vi.fn(),
  mockRelocateWorkspaceFileFolderByPath: vi.fn(),
  mockDeleteWorkspaceFileFolderByPath: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  moveWorkspaceFileItems: mockMoveWorkspaceFileItems,
  updateWorkspaceFileFolder: mockUpdateWorkspaceFileFolder,
  createWorkspaceFileFolder: mockCreateWorkspaceFileFolder,
  restoreWorkspaceFileFolder: mockRestoreWorkspaceFileFolder,
  renameWorkspaceFile: mockRenameWorkspaceFile,
  restoreWorkspaceFile: mockRestoreWorkspaceFile,
  bulkArchiveWorkspaceFileItems: mockBulkArchive,
  createWorkspaceFileFolderAtPath: mockCreateWorkspaceFileFolderAtPath,
  relocateWorkspaceFileFolderByPath: mockRelocateWorkspaceFileFolderByPath,
  deleteWorkspaceFileFolderByPath: mockDeleteWorkspaceFileFolderByPath,
  moveRenameWorkspaceFile: vi.fn(),
  FileConflictError: class FileConflictError extends Error {},
  WorkspaceFileFolderConflictError: class WorkspaceFileFolderConflictError extends Error {},
  WorkspaceFileMoveConflictError: class WorkspaceFileMoveConflictError extends Error {},
  WorkspaceFileItemsNotFoundError: class WorkspaceFileItemsNotFoundError extends Error {},
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceFilesChanged: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: new Proxy({}, { get: (_t, k) => String(k) }),
  AuditResourceType: new Proxy({}, { get: (_t, k) => String(k) }),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performCreateWorkspaceFileFolder,
  performCreateWorkspaceFileFolderAtPath,
  performDeleteWorkspaceFileFolderByPath,
  performMoveWorkspaceFileItems,
  performRelocateWorkspaceFileFolderByPath,
  performRenameWorkspaceFile,
  performRestoreWorkspaceFile,
  performRestoreWorkspaceFileFolder,
  performUpdateWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'

const WS = 'workspace-1'
const USER = 'user-1'

describe('workspace file orchestration error classification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps a missing move target to not_found, not internal', async () => {
    mockMoveWorkspaceFileItems.mockRejectedValue(
      new OrchestrationError('not_found', 'Target folder not found')
    )

    const result = await performMoveWorkspaceFileItems({
      workspaceId: WS,
      userId: USER,
      fileIds: ['wf_1'],
      targetFolderId: 'fold_missing',
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('not_found')
    expect(result.error).toBe('Target folder not found')
  })

  it('maps a self-descendant move to validation, not internal', async () => {
    mockMoveWorkspaceFileItems.mockRejectedValue(
      new OrchestrationError('validation', 'Cannot move a folder into one of its descendants')
    )

    const result = await performMoveWorkspaceFileItems({
      workspaceId: WS,
      userId: USER,
      folderIds: ['fold_1'],
      targetFolderId: 'fold_child',
    })

    expect(result.errorCode).toBe('validation')
  })

  it('maps a folder reparent cycle to validation, not internal', async () => {
    mockUpdateWorkspaceFileFolder.mockRejectedValue(
      new OrchestrationError('validation', 'Cannot move a folder into one of its descendants')
    )

    const result = await performUpdateWorkspaceFileFolder({
      workspaceId: WS,
      folderId: 'fold_1',
      userId: USER,
      parentId: 'fold_child',
    })

    expect(result.errorCode).toBe('validation')
  })

  it('maps a missing folder on update to not_found', async () => {
    mockUpdateWorkspaceFileFolder.mockRejectedValue(
      new OrchestrationError('not_found', 'Folder not found')
    )

    const result = await performUpdateWorkspaceFileFolder({
      workspaceId: WS,
      folderId: 'fold_missing',
      userId: USER,
      name: 'Q2',
    })

    expect(result.errorCode).toBe('not_found')
  })

  it('maps a missing parent on create to not_found', async () => {
    mockCreateWorkspaceFileFolder.mockRejectedValue(
      new OrchestrationError('not_found', 'Target folder not found')
    )

    const result = await performCreateWorkspaceFileFolder({
      workspaceId: WS,
      userId: USER,
      name: 'Q1',
      parentId: 'fold_missing',
    })

    expect(result.errorCode).toBe('not_found')
  })

  it('maps restoring into an archived workspace to validation', async () => {
    mockRestoreWorkspaceFileFolder.mockRejectedValue(
      new OrchestrationError('validation', 'Cannot restore folder into an archived workspace')
    )

    const result = await performRestoreWorkspaceFileFolder({
      workspaceId: WS,
      folderId: 'fold_1',
      userId: USER,
    })

    expect(result.errorCode).toBe('validation')
  })

  it('maps a missing file on rename to not_found', async () => {
    mockRenameWorkspaceFile.mockRejectedValue(new OrchestrationError('not_found', 'File not found'))

    const result = await performRenameWorkspaceFile({
      workspaceId: WS,
      fileId: 'wf_missing',
      name: 'renamed.csv',
      userId: USER,
    })

    expect(result.errorCode).toBe('not_found')
  })

  it('maps a missing file on restore to not_found', async () => {
    mockRestoreWorkspaceFile.mockRejectedValue(
      new OrchestrationError('not_found', 'File not found')
    )

    const result = await performRestoreWorkspaceFile({
      workspaceId: WS,
      fileId: 'wf_missing',
      userId: USER,
    })

    expect(result.errorCode).toBe('not_found')
  })

  it('classifies through a wrapper error chain, as drizzle produces inside a transaction', async () => {
    const wrapped = new Error('update "folder" set ... failed', {
      cause: new OrchestrationError('validation', 'Folder cannot be its own parent'),
    })
    mockUpdateWorkspaceFileFolder.mockRejectedValue(wrapped)

    const result = await performUpdateWorkspaceFileFolder({
      workspaceId: WS,
      folderId: 'fold_1',
      userId: USER,
      parentId: 'fold_1',
    })

    expect(result.errorCode).toBe('validation')
    expect(result.error).toBe('Folder cannot be its own parent')
  })

  it('leaves a genuinely unexpected fault as internal', async () => {
    mockRenameWorkspaceFile.mockRejectedValue(new Error('connection terminated unexpectedly'))

    const result = await performRenameWorkspaceFile({
      workspaceId: WS,
      fileId: 'wf_1',
      name: 'renamed.csv',
      userId: USER,
    })

    expect(result.errorCode).toBe('internal')
  })

  it('delegates path folder mutations to the existing file manager orchestration', async () => {
    const folder = {
      id: 'internal-folder-id',
      workspaceId: WS,
      userId: USER,
      name: 'Reports',
      parentId: null,
      path: 'Reports',
      sortOrder: 0,
      deletedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-02T00:00:00Z'),
    }
    mockCreateWorkspaceFileFolderAtPath.mockResolvedValue({ folder, path: '/Reports' })
    mockRelocateWorkspaceFileFolderByPath.mockResolvedValue({ folder, path: '/Archive' })
    mockDeleteWorkspaceFileFolderByPath.mockResolvedValue({ folders: 1, files: 2 })

    const created = await performCreateWorkspaceFileFolderAtPath({
      workspaceId: WS,
      userId: USER,
      path: '/Reports',
    })
    const relocated = await performRelocateWorkspaceFileFolderByPath({
      workspaceId: WS,
      userId: USER,
      path: '/Reports',
      destinationPath: '/Archive',
    })
    const deleted = await performDeleteWorkspaceFileFolderByPath({
      workspaceId: WS,
      userId: USER,
      path: '/Archive',
      recursive: true,
    })

    expect(created).toMatchObject({ success: true, path: '/Reports' })
    expect(relocated).toMatchObject({ success: true, path: '/Archive' })
    expect(deleted).toEqual({ success: true, deletedItems: { folders: 1, files: 2 } })
    expect(mockDeleteWorkspaceFileFolderByPath).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: USER,
      path: '/Archive',
      recursive: true,
    })
  })

  it('classifies a non-empty non-recursive folder delete as a conflict', async () => {
    mockDeleteWorkspaceFileFolderByPath.mockRejectedValue(
      new OrchestrationError('conflict', 'Folder is not empty')
    )

    const result = await performDeleteWorkspaceFileFolderByPath({
      workspaceId: WS,
      userId: USER,
      path: '/Reports',
      recursive: false,
    })

    expect(result).toEqual({
      success: false,
      error: 'Folder is not empty',
      errorCode: 'conflict',
    })
  })
})
