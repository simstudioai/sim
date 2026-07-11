/**
 * @vitest-environment node
 *
 * Resource-lock enforcement for the workspace-files orchestration layer.
 * `performRenameWorkspaceFile` / `performDeleteWorkspaceFileItems` /
 * `performMoveWorkspaceFileItems` all call `assertResourceMutable('file', id)`
 * for each file id and `assertFolderMutable(id, 'file')` for each folder id
 * before mutating — this guards a direct lock (`inherited: false`), a
 * folder-inherited lock (`inherited: true`) surface as `errorCode: 'locked'`
 * (423 via `workspaceFilesOrchestrationStatus`), and that an unrelated
 * (non-lock) update still goes through the lock check.
 */
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { auditMock, resourceLockMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBulkArchiveWorkspaceFileItems, mockMoveWorkspaceFileItems, mockRenameWorkspaceFile } =
  vi.hoisted(() => ({
    mockBulkArchiveWorkspaceFileItems: vi.fn(),
    mockMoveWorkspaceFileItems: vi.fn(),
    mockRenameWorkspaceFile: vi.fn(),
  }))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/folders/orchestration', () => ({
  performCreateFolder: vi.fn(),
  performRestoreFolder: vi.fn(),
  performUpdateFolder: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => {
  class FileConflictErrorStub extends Error {}
  class WorkspaceFileFolderConflictErrorStub extends Error {}
  class WorkspaceFileItemsNotFoundErrorStub extends Error {}
  class WorkspaceFileMoveConflictErrorStub extends Error {}
  return {
    bulkArchiveWorkspaceFileItems: mockBulkArchiveWorkspaceFileItems,
    moveWorkspaceFileItems: mockMoveWorkspaceFileItems,
    renameWorkspaceFile: mockRenameWorkspaceFile,
    restoreWorkspaceFile: vi.fn(),
    getWorkspaceFileFolder: vi.fn(),
    FileConflictError: FileConflictErrorStub,
    WorkspaceFileFolderConflictError: WorkspaceFileFolderConflictErrorStub,
    WorkspaceFileItemsNotFoundError: WorkspaceFileItemsNotFoundErrorStub,
    WorkspaceFileMoveConflictError: WorkspaceFileMoveConflictErrorStub,
  }
})

import {
  performDeleteWorkspaceFileItems,
  performMoveWorkspaceFileItems,
  performRenameWorkspaceFile,
  workspaceFilesOrchestrationStatus,
} from '@/lib/workspace-files/orchestration/file-folder-lifecycle'

describe('workspace-files orchestration — resource-lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceLockMockFns.mockAssertResourceMutable.mockReset()
    resourceLockMockFns.mockAssertFolderMutable.mockReset()
    resourceLockMockFns.mockAssertResourceMutable.mockResolvedValue(undefined)
    resourceLockMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
  })

  describe('performRenameWorkspaceFile', () => {
    it('returns a 423 (locked) when the file itself is directly locked', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', false, 'File is locked')
      )

      const result = await performRenameWorkspaceFile({
        workspaceId: 'ws-1',
        fileId: 'file-1',
        name: 'renamed.txt',
        userId: 'user-1',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(workspaceFilesOrchestrationStatus(result.errorCode)).toBe(423)
      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('file', 'file-1')
      expect(mockRenameWorkspaceFile).not.toHaveBeenCalled()
    })

    it('returns a 423 (locked, inherited) when the file is inside a locked folder', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', true, 'File is locked by its containing folder')
      )

      const result = await performRenameWorkspaceFile({
        workspaceId: 'ws-1',
        fileId: 'file-1',
        name: 'renamed.txt',
        userId: 'user-1',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(mockRenameWorkspaceFile).not.toHaveBeenCalled()
    })

    it('enforces the lock check on an unrelated (non-lock) rename', async () => {
      mockRenameWorkspaceFile.mockResolvedValueOnce({ id: 'file-1', name: 'renamed.txt' })

      const result = await performRenameWorkspaceFile({
        workspaceId: 'ws-1',
        fileId: 'file-1',
        name: 'renamed.txt',
        userId: 'user-1',
      })

      expect(result.success).toBe(true)
      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('file', 'file-1')
      expect(mockRenameWorkspaceFile).toHaveBeenCalledTimes(1)
    })

    it('skips the lock check for a lock-only update', async () => {
      mockRenameWorkspaceFile.mockResolvedValueOnce({ id: 'file-1', name: 'file-1.txt' })

      await performRenameWorkspaceFile({
        workspaceId: 'ws-1',
        fileId: 'file-1',
        name: 'file-1.txt',
        userId: 'user-1',
        locked: false,
        isLockOnlyUpdate: true,
      })

      expect(resourceLockMockFns.mockAssertResourceMutable).not.toHaveBeenCalled()
    })
  })

  describe('performDeleteWorkspaceFileItems', () => {
    it('returns a 423 (locked) when a targeted file is directly locked', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', false, 'File is locked')
      )

      const result = await performDeleteWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(workspaceFilesOrchestrationStatus(result.errorCode)).toBe(423)
      expect(mockBulkArchiveWorkspaceFileItems).not.toHaveBeenCalled()
    })

    it('returns a 423 (locked, inherited) when a targeted folder is locked (bulk folderIds)', async () => {
      resourceLockMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', true, 'Folder is locked')
      )

      const result = await performDeleteWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        folderIds: ['folder-1'],
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledWith('folder-1', 'file')
      expect(mockBulkArchiveWorkspaceFileItems).not.toHaveBeenCalled()
    })

    it('enforces the lock check on an unrelated (non-lock) bulk delete', async () => {
      mockBulkArchiveWorkspaceFileItems.mockResolvedValueOnce({ files: 1, folders: 0 })

      const result = await performDeleteWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
      })

      expect(result.success).toBe(true)
      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('file', 'file-1')
      expect(mockBulkArchiveWorkspaceFileItems).toHaveBeenCalledTimes(1)
    })
  })

  describe('performMoveWorkspaceFileItems', () => {
    it('returns a 423 (locked) when a targeted file is directly locked', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', false, 'File is locked')
      )

      const result = await performMoveWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
        targetFolderId: 'folder-2',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(workspaceFilesOrchestrationStatus(result.errorCode)).toBe(423)
      expect(mockMoveWorkspaceFileItems).not.toHaveBeenCalled()
    })

    it('returns a 423 (locked, inherited) when a targeted folder is locked (bulk folderIds)', async () => {
      resourceLockMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', true, 'Folder is locked')
      )

      const result = await performMoveWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        folderIds: ['folder-1'],
        targetFolderId: 'folder-2',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledWith('folder-1', 'file')
      expect(mockMoveWorkspaceFileItems).not.toHaveBeenCalled()
    })

    it('enforces the lock check on an unrelated (non-lock) bulk move', async () => {
      mockMoveWorkspaceFileItems.mockResolvedValueOnce({ movedFiles: 1, movedFolders: 0 })

      const result = await performMoveWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
        targetFolderId: 'folder-2',
      })

      expect(result.success).toBe(true)
      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('file', 'file-1')
      expect(mockMoveWorkspaceFileItems).toHaveBeenCalledTimes(1)
    })

    it('returns a 423 (locked) when the item is unlocked but the destination folder is locked', async () => {
      // Regression test: the source-item/source-folder checks above only cover each
      // moved item's *current* location -- without a separate check on targetFolderId,
      // an unlocked item could be moved into a locked destination folder.
      resourceLockMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
        new ResourceLockedError('file', false, 'Folder is locked')
      )

      const result = await performMoveWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
        targetFolderId: 'folder-2',
      })

      expect(result).toMatchObject({ success: false, errorCode: 'locked' })
      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('file', 'file-1')
      expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledWith('folder-2', 'file')
      expect(mockMoveWorkspaceFileItems).not.toHaveBeenCalled()
    })

    it('does not check destination lock status for a root move (no targetFolderId)', async () => {
      mockMoveWorkspaceFileItems.mockResolvedValueOnce({ movedFiles: 1, movedFolders: 0 })

      const result = await performMoveWorkspaceFileItems({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileIds: ['file-1'],
        targetFolderId: null,
      })

      expect(result.success).toBe(true)
      expect(resourceLockMockFns.mockAssertFolderMutable).not.toHaveBeenCalled()
    })
  })
})
