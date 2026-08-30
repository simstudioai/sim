import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class FileConflictError extends Error {
    readonly code = 'FILE_EXISTS' as const
  }

  return {
    FileConflictError,
    admitCreateWorkspaceFile: vi.fn(),
    ensureWorkspaceFileFolderPath: vi.fn(),
    findWorkspaceFileFolderIdByPath: vi.fn(),
    normalizeWorkspaceFileItemName: vi.fn((name: string) => name.trim()),
    getWorkspaceFileByName: vi.fn(),
    resolveWorkspaceFileReference: vi.fn(),
    updateWorkspaceFileContent: vi.fn(),
    uploadWorkspaceFile: vi.fn(),
    createWorkspaceFileBufferByPath: { execute: vi.fn() },
    updateWorkspaceFileContentBufferByPath: { execute: vi.fn() },
  }
})

vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: mocks.admitCreateWorkspaceFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath: mocks.findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName: mocks.normalizeWorkspaceFileItemName,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  FileConflictError: mocks.FileConflictError,
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
  updateWorkspaceFileContent: mocks.updateWorkspaceFileContent,
  uploadWorkspaceFile: mocks.uploadWorkspaceFile,
}))

vi.mock('@/lib/workspace-files/application/write-workspace-file-by-path', () => ({
  createWorkspaceFileBufferByPath: mocks.createWorkspaceFileBufferByPath,
  updateWorkspaceFileContentBufferByPath: mocks.updateWorkspaceFileContentBufferByPath,
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
}))

import {
  validateWorkspaceFileWriteTarget,
  writeWorkspaceFileByPath,
} from '@/lib/mothership/vfs/resource-writer'

describe('resource writer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue({
      folderId: 'folder-id',
      createdFolderIds: [],
    })
    mocks.admitCreateWorkspaceFile.mockResolvedValue(undefined)
  })

  it('refuses to write into a workspace the acting user is not a member of', async () => {
    mocks.resolveWorkspaceFileReference.mockRejectedValue(new Error('Insufficient permissions'))

    await expect(
      writeWorkspaceFileByPath({
        workspaceId: 'workspace-victim',
        principal: { kind: 'session', userId: 'attacker', sessionId: 'session-1' },
        target: { path: 'files/README.md', mode: 'overwrite' },
        buffer: Buffer.from('owned'),
        inferredMimeType: 'text/markdown',
      })
    ).rejects.toThrow('Insufficient permissions')

    expect(mocks.resolveWorkspaceFileReference).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-victim' })
    )
    expect(mocks.updateWorkspaceFileContentBufferByPath.execute).not.toHaveBeenCalled()
  })

  it('refuses to write for a read-only workspace member', async () => {
    mocks.admitCreateWorkspaceFile.mockRejectedValue(new Error('Insufficient permissions'))

    await expect(
      writeWorkspaceFileByPath({
        workspaceId: 'workspace-1',
        principal: { kind: 'session', userId: 'reader', sessionId: 'session-1' },
        target: { path: 'files/notes.md', mode: 'create' },
        buffer: Buffer.from('hello'),
        inferredMimeType: 'text/markdown',
      })
    ).rejects.toThrow('Insufficient permissions')

    expect(mocks.createWorkspaceFileBufferByPath.execute).not.toHaveBeenCalled()
  })

  it('refuses to validate a write target in a workspace the user cannot write to', async () => {
    mocks.resolveWorkspaceFileReference.mockRejectedValue(new Error('Insufficient permissions'))

    await expect(
      validateWorkspaceFileWriteTarget({
        workspaceId: 'workspace-victim',
        principal: { kind: 'session', userId: 'attacker', sessionId: 'session-1' },
        target: { path: 'files/README.md', mode: 'overwrite' },
      })
    ).rejects.toThrow('Insufficient permissions')

    expect(mocks.findWorkspaceFileFolderIdByPath).not.toHaveBeenCalled()
  })

  it('auto-creates missing parent folders for plain workspace file creates', async () => {
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue({
      folderId: 'folder-nested',
      createdFolderIds: [],
    })
    mocks.createWorkspaceFileBufferByPath.execute.mockResolvedValue({
      id: 'file-report',
      name: 'summary.csv',
      size: 7,
      contentType: 'text/csv',
      downloadUrl: '/download',
      vfsPath: 'files/Reports/2026/summary.csv',
      mode: 'create',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/csv',
    })

    expect(mocks.createWorkspaceFileBufferByPath.execute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: expect.objectContaining({
        workspaceId: 'workspace-1',
        path: 'files/Reports/2026/summary.csv',
        content: Buffer.from('content'),
        contentType: 'text/csv',
      }),
    })
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
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

  it('authorizes overwrite target resolution through the shared application resolver', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue({
      id: 'file-report',
      name: 'summary.csv',
      size: 7,
      type: 'text/csv',
      folderPath: 'Reports/2026',
    })

    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
    const validation = await validateWorkspaceFileWriteTarget({
      workspaceId: 'workspace-1',
      principal,
      target: { path: 'files/Reports/2026/summary.csv', mode: 'overwrite' },
    })

    expect(mocks.resolveWorkspaceFileReference).toHaveBeenCalledWith({
      principal,
      operation: expect.objectContaining({ id: 'files.update_content' }),
      workspaceId: 'workspace-1',
      reference: 'files/Reports/2026/summary.csv',
    })
    expect(validation).toMatchObject({
      mode: 'overwrite',
      existingFileId: 'file-report',
      vfsPath: 'files/Reports/2026/summary.csv',
    })
  })

  it('upserts: an overwrite of a missing target falls through to create', async () => {
    const { OrchestrationError } = await import('@/lib/core/orchestration/types')
    mocks.resolveWorkspaceFileReference.mockRejectedValue(
      new OrchestrationError('not_found', 'File not found')
    )
    mocks.createWorkspaceFileBufferByPath.execute.mockResolvedValue({
      id: 'file-new',
      name: 'chart.png',
      size: 3,
      contentType: 'image/png',
      downloadUrl: 'url',
      vfsPath: 'files/chart.png',
    })

    const written = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      principal: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
      target: { path: 'files/chart.png', mode: 'overwrite' },
      buffer: Buffer.from('png'),
      inferredMimeType: 'image/png',
    })

    expect(mocks.updateWorkspaceFileContentBufferByPath.execute).not.toHaveBeenCalled()
    expect(mocks.createWorkspaceFileBufferByPath.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ path: 'files/chart.png', mode: 'create' }),
      })
    )
    expect(written).toMatchObject({ id: 'file-new', mode: 'create' })
  })

  it('keeps a genuine overwrite on the update path', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue({ id: 'file-1', name: 'chart.png' })
    mocks.updateWorkspaceFileContentBufferByPath.execute.mockResolvedValue({
      id: 'file-1',
      name: 'chart.png',
      size: 3,
      contentType: 'image/png',
      downloadUrl: 'url',
      vfsPath: 'files/chart.png',
    })

    const written = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      principal: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
      target: { path: 'files/chart.png', mode: 'overwrite' },
      buffer: Buffer.from('png'),
      inferredMimeType: 'image/png',
    })

    expect(mocks.createWorkspaceFileBufferByPath.execute).not.toHaveBeenCalled()
    expect(written).toMatchObject({ id: 'file-1', mode: 'overwrite' })
  })
})
