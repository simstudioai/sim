/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import {
  createWorkspaceFileBufferByPath,
  createWorkspaceFileByPath,
  updateWorkspaceFileContentBufferByPath,
  updateWorkspaceFileContentByPath,
} from '@/lib/workspace-files/application/write-workspace-file-by-path'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  create: vi.fn(),
  createBuffer: vi.fn(),
  update: vi.fn(),
  updateBuffer: vi.fn(),
  admitCreate: vi.fn(),
  ensureFolder: vi.fn(),
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mocks.resolve,
}))
vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: mocks.admitCreate,
  createWorkspaceFile: { execute: mocks.create },
  createWorkspaceFileFromBuffer: { execute: mocks.createBuffer },
}))
vi.mock('@/lib/workspace-files/application/update-workspace-file-content', () => ({
  updateWorkspaceFileContent: { execute: mocks.update },
  updateWorkspaceFileContentFromBuffer: { execute: mocks.updateBuffer },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureFolder,
  normalizeWorkspaceFileItemName: (name: string) => name.trim(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceContext: vi.fn(),
}))

const principal = { kind: 'session' as const, userId: 'user', sessionId: 'session' }
const oldFile: WorkspaceFileRecord = {
  id: 'file',
  workspaceId: 'workspace',
  name: 'report.txt',
  folderPath: 'Reports',
  key: 'key',
  path: '/serve/key',
  size: 3,
  type: 'text/plain',
  uploadedBy: 'user',
  uploadedAt: new Date('2026-09-23T10:00:00Z'),
  updatedAt: new Date('2026-09-23T10:00:00Z'),
  contentUpdatedAt: new Date('2026-09-23T10:00:00Z'),
}
const committedFile = {
  ...oldFile,
  key: 'new-key',
  contentUpdatedAt: new Date('2026-09-23T10:01:00Z'),
}
const input = {
  workspaceId: 'workspace',
  path: 'files/Reports/report.txt',
  mode: 'overwrite' as const,
  contentType: 'text/plain',
  expectedRevision: workspaceFileRevision(oldFile)!,
}

describe('conditional writes by path', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolve.mockResolvedValue(oldFile)
    mocks.update.mockResolvedValue({ file: committedFile })
    mocks.updateBuffer.mockResolvedValue({ file: committedFile })
    mocks.create.mockResolvedValue({ file: committedFile })
    mocks.createBuffer.mockResolvedValue({ file: committedFile })
    mocks.ensureFolder.mockResolvedValue({ folderId: 'folder' })
  })

  it.each(['text', 'buffer'] as const)(
    'passes the original %s precondition to the committing operation and returns its new revision',
    async (kind) => {
      mocks.resolve.mockResolvedValue({
        ...oldFile,
        contentUpdatedAt: new Date('2026-09-23T10:00:30Z'),
      })
      const result =
        kind === 'text'
          ? await updateWorkspaceFileContentByPath.execute({
              principal,
              input: { ...input, content: 'new', encoding: 'utf-8' },
            })
          : await updateWorkspaceFileContentBufferByPath.execute({
              principal,
              input: { ...input, content: Buffer.from('new') },
            })
      expect(kind === 'text' ? mocks.update : mocks.updateBuffer).toHaveBeenCalledWith({
        principal,
        input: expect.objectContaining({
          fileId: oldFile.id,
          assertedWorkspaceId: 'workspace',
          expectedRevision: input.expectedRevision,
        }),
      })
      expect(result).toMatchObject({
        id: 'file',
        mode: 'overwrite',
        revision: workspaceFileRevision(committedFile),
      })
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.createBuffer).not.toHaveBeenCalled()
    }
  )

  it.each(['text', 'buffer'] as const)(
    'propagates the committing %s CAS conflict without retrying or creating',
    async (kind) => {
      const update = kind === 'text' ? mocks.update : mocks.updateBuffer
      update.mockRejectedValueOnce(new OrchestrationError('conflict', 'File changed'))
      const write =
        kind === 'text'
          ? updateWorkspaceFileContentByPath.execute({
              principal,
              input: { ...input, content: 'new', encoding: 'utf-8' },
            })
          : updateWorkspaceFileContentBufferByPath.execute({
              principal,
              input: { ...input, content: Buffer.from('new') },
            })
      await expect(write).rejects.toMatchObject({ code: 'conflict' })
      expect(update).toHaveBeenCalledOnce()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.createBuffer).not.toHaveBeenCalled()
    }
  )

  it.each(['text', 'buffer'] as const)(
    'does not create a missing %s overwrite target',
    async (kind) => {
      mocks.resolve.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))
      const write =
        kind === 'text'
          ? updateWorkspaceFileContentByPath.execute({
              principal,
              input: { ...input, content: 'new', encoding: 'utf-8' },
            })
          : updateWorkspaceFileContentBufferByPath.execute({
              principal,
              input: { ...input, content: Buffer.from('new') },
            })
      await expect(write).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.updateBuffer).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.createBuffer).not.toHaveBeenCalled()
    }
  )

  it.each(['text', 'buffer'] as const)(
    'returns a revision for created %s content',
    async (kind) => {
      const createInput = { ...input, mode: 'create' as const, expectedRevision: undefined }
      const result =
        kind === 'text'
          ? await createWorkspaceFileByPath.execute({
              principal,
              input: { ...createInput, content: 'new', encoding: 'utf-8' },
            })
          : await createWorkspaceFileBufferByPath.execute({
              principal,
              input: { ...createInput, content: Buffer.from('new') },
            })
      expect(result).toMatchObject({
        mode: 'create',
        revision: workspaceFileRevision(committedFile),
      })
    }
  )

  it.each(['text', 'buffer'] as const)(
    'refuses a conditional %s create even when the input mislabels the operation',
    async (kind) => {
      const write =
        kind === 'text'
          ? createWorkspaceFileByPath.execute({
              principal,
              input: { ...input, content: 'new', encoding: 'utf-8' },
            })
          : createWorkspaceFileBufferByPath.execute({
              principal,
              input: { ...input, content: Buffer.from('new') },
            })
      await expect(write).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.admitCreate).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.createBuffer).not.toHaveBeenCalled()
    }
  )
})
