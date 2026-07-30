import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class FileConflictError extends Error {
    readonly code = 'FILE_EXISTS' as const
  }

  return {
    FileConflictError,
    ensureWorkspaceFileFolderPath: vi.fn(),
    findWorkspaceFileFolderIdByPath: vi.fn(),
    normalizeWorkspaceFileItemName: vi.fn((name: string) => name.trim()),
    getWorkspaceFileByName: vi.fn(),
    resolveWorkspaceFileReference: vi.fn(),
    updateWorkspaceFileContent: vi.fn(),
    uploadWorkspaceFile: vi.fn(),
  }
})

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath: mocks.findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName: mocks.normalizeWorkspaceFileItemName,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  FileConflictError: mocks.FileConflictError,
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
  updateWorkspaceFileContent: mocks.updateWorkspaceFileContent,
  uploadWorkspaceFile: mocks.uploadWorkspaceFile,
}))

import { validateWorkspaceFileWriteTarget, writeWorkspaceFileByPath } from './resource-writer'

describe('resource writer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('folder-id')
  })

  it('auto-creates missing parent folders for plain workspace file creates', async () => {
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('folder-nested')
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'file-report',
      name: 'summary.csv',
      size: 7,
      type: 'text/csv',
      url: '/download',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/csv',
    })

    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['Reports', '2026'],
    })
    expect(mocks.findWorkspaceFileFolderIdByPath).not.toHaveBeenCalled()
    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('content'),
      'summary.csv',
      'text/csv',
      { folderId: 'folder-nested' }
    )
    expect(result).toMatchObject({
      id: 'file-report',
      vfsPath: 'files/Reports/2026/summary.csv',
      mode: 'create',
    })
  })

  it('validates create targets read-only, resolving existing parent folders without creating', async () => {
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue('folder-nested')
    mocks.getWorkspaceFileByName.mockResolvedValue(null)

    const validation = await validateWorkspaceFileWriteTarget({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
    })

    expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    expect(validation).toMatchObject({
      mode: 'create',
      vfsPath: 'files/Reports/2026/summary.csv',
      fileName: 'summary.csv',
      folderId: 'folder-nested',
    })
  })

  it('accepts create targets with missing parent folders during validation without creating them', async () => {
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)

    const validation = await validateWorkspaceFileWriteTarget({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
    })

    expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    expect(mocks.getWorkspaceFileByName).not.toHaveBeenCalled()
    expect(validation).toMatchObject({
      mode: 'create',
      vfsPath: 'files/Reports/2026/summary.csv',
      fileName: 'summary.csv',
      folderId: null,
    })
  })
})
