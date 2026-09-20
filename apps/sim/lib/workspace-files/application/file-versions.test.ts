/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ContentVersionConflictError: class extends Error {},
  loadActive: vi.fn(),
  getFile: vi.fn(),
  fetchBuffer: vi.fn(),
  updateContent: vi.fn(),
  deleteStored: vi.fn(),
  getVersion: vi.fn(),
  getCurrentVersion: vi.fn(),
  getProvenance: vi.fn(),
  streamRecord: vi.fn(),
  recordAudit: vi.fn(),
  notify: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    FILE_DOWNLOADED: 'FILE_DOWNLOADED',
    FILE_REVERTED: 'FILE_REVERTED',
    FILE_VERSION_DELETED: 'FILE_VERSION_DELETED',
  },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadActive,
  loadWorkspaceFileLifecycleContext: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError: mocks.ContentVersionConflictError,
  deleteWorkspaceFileVersion: mocks.deleteStored,
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFile: mocks.getFile,
  updateWorkspaceFileContent: mocks.updateContent,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-versions', () => ({
  getCurrentWorkspaceFileVersion: mocks.getCurrentVersion,
  getWorkspaceFileVersion: mocks.getVersion,
  getWorkspaceFileVersionProvenance: mocks.getProvenance,
  queryWorkspaceFileVersions: vi.fn(),
}))
vi.mock('@/lib/workspace-files/application/download-workspace-file', () => ({
  streamWorkspaceFileRecord: mocks.streamRecord,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-text', () => ({
  extractWorkspaceFileRecordText: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/' }))

import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import {
  deleteWorkspaceFileVersion,
  downloadWorkspaceFileVersion,
  revertWorkspaceFileVersion,
} from '@/lib/workspace-files/application/file-versions'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'notes.md',
  key: 'workspace/workspace-1/3-current-notes.md',
  path: '/api/files/serve/current?context=workspace',
  size: 12,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  folderId: null,
  folderPath: null,
  deletedAt: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-03T00:00:00Z'),
  contentUpdatedAt: new Date('2026-01-03T00:00:00Z'),
}

function version(number: number, overrides: Record<string, unknown> = {}) {
  return {
    fileId: 'file-1',
    version: number,
    key: `workspace/workspace-1/${number}-notes.md`,
    size: 10,
    contentType: 'text/markdown',
    source: 'api',
    authorUserIds: ['user-1'],
    restoredFromVersion: null,
    isCurrent: false,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    supersededAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  }
}

const current = version(3, { key: file.key, isCurrent: true, supersededAt: null })

function objectMissing() {
  return Object.assign(new Error('Failed to download file: missing'), {
    cause: Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
  })
}

describe('file version use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadActive.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getFile.mockResolvedValue(file)
    mocks.getCurrentVersion.mockResolvedValue(current)
    mocks.getVersion.mockImplementation(async (_file: unknown, number: number) =>
      number === 3 ? current : number === 2 ? version(2) : null
    )
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('old content'))
    mocks.getProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.updateContent.mockResolvedValue({ ...file, key: 'new-key', currentVersion: 4 })
    mocks.notify.mockResolvedValue(undefined)
  })

  describe('revertWorkspaceFileVersion', () => {
    it('writes the version as a new revert version carrying its provenance snapshot', async () => {
      mocks.getVersion.mockImplementation(async (_file: unknown, number: number) =>
        number === 2
          ? version(2)
          : number === 4
            ? version(4, { source: 'revert', restoredFromVersion: 2, isCurrent: true })
            : current
      )

      const result = await revertWorkspaceFileVersion.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
      })

      expect(mocks.updateContent).toHaveBeenCalledWith(
        'workspace-1',
        'file-1',
        'user-1',
        Buffer.from('old content'),
        'text/markdown',
        {
          version: { source: 'revert', authorUserId: 'user-1', restoredFromVersion: 2 },
          expectedUpdatedAt: file.contentUpdatedAt,
          secretProvenancePolicy: {
            mode: 'reinstate',
            snapshot: { status: 'exact', entries: [] },
          },
        }
      )
      expect(result).toMatchObject({
        reverted: true,
        revertedFrom: 3,
        version: { version: 4, restoredFromVersion: 2 },
      })
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FILE_REVERTED',
          metadata: expect.objectContaining({
            previousVersion: 3,
            restoredVersion: 2,
            newVersion: 4,
          }),
        })
      )
      expect(mocks.getProvenance).toHaveBeenCalledWith('file-1', 2)
      expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
    })

    it('refuses to reinstate provenance it could not read', async () => {
      mocks.getProvenance.mockResolvedValueOnce(null)

      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.updateContent).not.toHaveBeenCalled()
    })

    it('does nothing, audits nothing, and notifies no one when the version is already current', async () => {
      const result = await revertWorkspaceFileVersion.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 3 },
      })

      expect(result).toMatchObject({ reverted: false, version: { version: 3 } })
      expect(mocks.updateContent).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
    })

    /** The revision guards content, so it catches an edit that folded into the current version. */
    it('reverts when the revision still names the current content', async () => {
      mocks.getVersion.mockImplementation(async (_file: unknown, number: number) =>
        number === 2 ? version(2) : number === 4 ? version(4, { isCurrent: true }) : current
      )

      await revertWorkspaceFileVersion.execute({
        principal,
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
          version: 2,
          expectedRevision: workspaceFileRevision(file),
        },
      })

      expect(mocks.updateContent.mock.calls[0][5]).toMatchObject({
        expectedUpdatedAt: file.contentUpdatedAt,
      })
    })

    /** Reverting to the version that is already current must still honour a stale revision. */
    it('refuses a stale revision even when the requested version is already current', async () => {
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: {
            fileId: 'file-1',
            assertedWorkspaceId: 'workspace-1',
            version: 3,
            expectedRevision: workspaceFileRevision({
              ...file,
              contentUpdatedAt: new Date('2020-01-01T00:00:00Z'),
            }),
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.updateContent).not.toHaveBeenCalled()
    })

    it('refuses a revision issued for a different file', async () => {
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: {
            fileId: 'file-1',
            assertedWorkspaceId: 'workspace-1',
            version: 2,
            expectedRevision: workspaceFileRevision({ ...file, id: 'file-2' }),
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.updateContent).not.toHaveBeenCalled()
    })

    it('refuses a stale expected current version without writing', async () => {
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: {
            fileId: 'file-1',
            assertedWorkspaceId: 'workspace-1',
            version: 2,
            expectedCurrentVersion: 2,
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.updateContent).not.toHaveBeenCalled()
    })

    it('maps a racing content write to a conflict', async () => {
      mocks.updateContent.mockRejectedValueOnce(new mocks.ContentVersionConflictError('raced'))

      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    })

    it('refuses a version above the buffered revert limit before reading it', async () => {
      mocks.getVersion.mockResolvedValueOnce(version(2, { size: MAX_BUFFERED_TRANSFER_BYTES + 1 }))

      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'payload_too_large' })
      expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    })

    it('answers 404 for a version that never existed or whose object is gone', async () => {
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 9 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      mocks.fetchBuffer.mockRejectedValueOnce(objectMissing())
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.updateContent).not.toHaveBeenCalled()
    })

    it('conceals a file asserted under another workspace', async () => {
      await expect(
        revertWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.getFile).not.toHaveBeenCalled()
    })
  })

  describe('downloadWorkspaceFileVersion', () => {
    it('streams the version bytes under the file name and audits the version', async () => {
      mocks.streamRecord.mockImplementation(async (record: { key: string }) => ({
        file: record,
        stream: new ReadableStream(),
        contentLength: 10,
        contentType: 'text/markdown',
      }))

      const result = await downloadWorkspaceFileVersion.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
      })

      expect(mocks.streamRecord).toHaveBeenCalledWith(
        expect.objectContaining({ key: version(2).key, name: 'notes.md', url: undefined }),
        principal
      )
      expect(result.file).toBe(file)
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FILE_DOWNLOADED',
          metadata: expect.objectContaining({ version: 2, bytes: 10 }),
        })
      )
    })

    it('answers 404 when the version object was removed mid-request', async () => {
      mocks.streamRecord.mockRejectedValueOnce(objectMissing().cause)

      await expect(
        downloadWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  describe('deleteWorkspaceFileVersion', () => {
    it('deletes a superseded version and audits it', async () => {
      mocks.deleteStored.mockResolvedValueOnce('deleted')

      const result = await deleteWorkspaceFileVersion.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
      })

      expect(result).toEqual({ file, version: 2 })
      expect(mocks.deleteStored).toHaveBeenCalledWith('workspace-1', 'file-1', 2)
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FILE_VERSION_DELETED',
          metadata: expect.objectContaining({ version: 2 }),
        })
      )
    })

    it('refuses to delete the current version', async () => {
      await expect(
        deleteWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 3 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.deleteStored).not.toHaveBeenCalled()
    })

    it('refuses to delete the newest recorded version, whose number the next write would reuse', async () => {
      mocks.deleteStored.mockResolvedValueOnce('newest')

      await expect(
        deleteWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    })

    it('answers 404 when the version disappeared before the delete committed', async () => {
      mocks.deleteStored.mockResolvedValueOnce('not_found')

      await expect(
        deleteWorkspaceFileVersion.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', version: 2 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    })
  })
})
