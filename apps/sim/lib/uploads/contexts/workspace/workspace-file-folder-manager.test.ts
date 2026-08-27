/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAcquireFolderMutationLock, mockDeduplicateFolderName } = vi.hoisted(() => ({
  mockAcquireFolderMutationLock: vi.fn(),
  mockDeduplicateFolderName: vi.fn(),
}))

vi.mock('@/lib/folders/locks', () => ({
  acquireFolderMutationLock: mockAcquireFolderMutationLock,
}))

vi.mock('@/lib/folders/naming', () => ({
  deduplicateFolderName: mockDeduplicateFolderName,
}))

import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import {
  archiveWorkspaceFileFolderIfEmpty,
  buildWorkspaceFileFolderPathMap,
  createWorkspaceFileFolder,
  ensureWorkspaceFileFolderPath,
  normalizeWorkspaceFileItemName,
  WorkspaceFileFolderConflictError,
  WorkspaceFileItemsNotFoundError,
  WorkspaceFileMoveConflictError,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'

describe('createWorkspaceFileFolder', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAcquireFolderMutationLock.mockReset()
    mockDeduplicateFolderName.mockReset()
  })

  it('uses the shared numeric suffix allocator when exact naming is disabled', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z')
    const inserted = {
      id: 'folder-archive-3',
      resourceType: 'file',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Archive (3)',
      parentId: null,
      sortOrder: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const validateResolvedName = vi.fn()
    mockDeduplicateFolderName.mockResolvedValueOnce('Archive (3)')
    dbChainMockFns.returning.mockResolvedValueOnce([inserted])

    await expect(
      createWorkspaceFileFolder({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Archive',
        exactName: false,
        validateResolvedName,
      })
    ).resolves.toMatchObject({ name: 'Archive (3)' })

    expect(mockDeduplicateFolderName).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      null,
      'Archive',
      'file'
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Archive (3)' })
    )
    expect(validateResolvedName).toHaveBeenCalledWith('Archive (3)')
    expect(validateResolvedName.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.values.mock.invocationCallOrder[0]
    )
  })
})

describe('workspace file folder paths', () => {
  it('builds nested paths from parent relationships', () => {
    const paths = buildWorkspaceFileFolderPathMap([
      { id: 'reports', name: 'Reports', parentId: null },
      { id: 'quarterly', name: 'Quarterly', parentId: 'reports' },
      { id: 'archive', name: 'Archive', parentId: null },
    ])

    expect(paths.get('reports')).toBe('Reports')
    expect(paths.get('quarterly')).toBe('Reports/Quarterly')
    expect(paths.get('archive')).toBe('Archive')
  })

  it('escapes slashes within folder names without changing hierarchy delimiters', () => {
    const paths = buildWorkspaceFileFolderPathMap([
      { id: 'legal', name: 'Finance/Legal', parentId: null },
      { id: 'quarterly', name: 'Quarterly', parentId: 'legal' },
    ])

    expect(paths.get('legal')).toBe('Finance\\/Legal')
    expect(paths.get('quarterly')).toBe('Finance\\/Legal/Quarterly')
  })

  it('rejects names that would create ambiguous paths', () => {
    expect(normalizeWorkspaceFileItemName('Reports', 'Folder')).toBe('Reports')
    expect(() => normalizeWorkspaceFileItemName('A/B', 'Folder')).toThrow(
      'Folder name cannot contain path separators or dot segments'
    )
    expect(() => normalizeWorkspaceFileItemName('..', 'File')).toThrow(
      'File name cannot contain path separators or dot segments'
    )
  })

  it('rejects interior control characters that would render differently than they are stored', () => {
    expect(() => normalizeWorkspaceFileItemName('a\tb.txt', 'File')).toThrow(
      'File name cannot contain control characters'
    )
    expect(() => normalizeWorkspaceFileItemName('a\u0000b', 'Folder')).toThrow(
      'Folder name cannot contain control characters'
    )
    expect(() => normalizeWorkspaceFileItemName('a\u007fb', 'File')).toThrow(
      'File name cannot contain control characters'
    )
    expect(normalizeWorkspaceFileItemName('\treport.txt\n', 'File')).toBe('report.txt')
    expect(normalizeWorkspaceFileItemName('Q3 report — final.txt', 'File')).toBe(
      'Q3 report — final.txt'
    )
  })

  it('rejects oversized ensured paths before persisting any folders', async () => {
    await expect(
      ensureWorkspaceFileFolderPath({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        pathSegments: Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, () => 'nested'),
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`,
    })
  })
})

describe('workspace file folder failure classification', () => {
  it('classifies a duplicate folder name as a conflict for every surface', () => {
    const error = new WorkspaceFileFolderConflictError('Reports')
    const classified = asOrchestrationError(error)

    expect(classified?.code).toBe('conflict')
    expect(statusForOrchestrationError(classified?.code)).toBe(409)
    expect(error.message).toBe('A folder named "Reports" already exists in this location')
  })

  it('classifies a destination name collision as a conflict', () => {
    const classified = asOrchestrationError(new WorkspaceFileMoveConflictError('report.pdf'))

    expect(classified?.code).toBe('conflict')
    expect(statusForOrchestrationError(classified?.code)).toBe(409)
  })

  it('classifies missing items as not found', () => {
    const classified = asOrchestrationError(
      new WorkspaceFileItemsNotFoundError(['file-1'], ['folder-1'])
    )

    expect(classified?.code).toBe('not_found')
    expect(statusForOrchestrationError(classified?.code)).toBe(404)
    expect(classified?.message).toBe(
      'Workspace file items not found (files: file-1; folders: folder-1)'
    )
  })

  it('classifies a conflict raised inside a wrapping transaction error', () => {
    const wrapped = new Error('insert into "folder" ...', {
      cause: new WorkspaceFileFolderConflictError('Reports'),
    })

    expect(asOrchestrationError(wrapped)?.code).toBe('conflict')
  })
})

describe('archiveWorkspaceFileFolderIfEmpty', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAcquireFolderMutationLock.mockReset()
  })

  it('archives an empty folder under the folder mutation lock', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'folder-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'folder-1' }])

    await expect(
      archiveWorkspaceFileFolderIfEmpty({ workspaceId: 'workspace-1', folderId: 'folder-1' })
    ).resolves.toBe(true)

    expect(mockAcquireFolderMutationLock).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      'file'
    )
  })

  it('returns false without archiving when the folder is missing or already archived', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      archiveWorkspaceFileFolderIfEmpty({ workspaceId: 'workspace-1', folderId: 'folder-1' })
    ).resolves.toBe(false)

    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('refuses to archive a folder that still holds an active file', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'folder-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'file-1' }])

    await expect(
      archiveWorkspaceFileFolderIfEmpty({ workspaceId: 'workspace-1', folderId: 'folder-1' })
    ).rejects.toMatchObject({ code: 'conflict', message: 'Folder is not empty' })

    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('refuses to archive a folder with an active child folder', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'folder-1' }])
      .mockResolvedValueOnce([{ id: 'child-1' }])
      .mockResolvedValueOnce([])

    await expect(
      archiveWorkspaceFileFolderIfEmpty({ workspaceId: 'workspace-1', folderId: 'folder-1' })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
