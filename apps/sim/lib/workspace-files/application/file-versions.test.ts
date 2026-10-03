import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getVersion: vi.fn(),
  getCurrentVersion: vi.fn(),
  getProvenance: vi.fn(),
  streamRecord: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-versions', () => ({
  getCurrentWorkspaceFileVersion: hoisted.getCurrentVersion,
  getWorkspaceFileVersion: hoisted.getVersion,
  getWorkspaceFileVersionProvenance: hoisted.getProvenance,
  queryWorkspaceFileVersions: vi.fn(),
}))
vi.mock('@/lib/workspace-files/application/download-workspace-file', () => ({
  streamWorkspaceFileRecord: hoisted.streamRecord,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-text', () => ({
  extractWorkspaceFileRecordText: vi.fn(),
}))
vi.mock('@/lib/uploads', () => uploadsMock)

import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import {
  deleteWorkspaceFileVersion,
  revertWorkspaceFileVersion,
} from '@/lib/workspace-files/application/file-versions'

const mocks = {
  deleteStored: workspaceUploadsMockFns.mockDeleteWorkspaceFileVersion,
  fetchBuffer: workspaceUploadsMockFns.mockFetchWorkspaceFileBuffer,
  getFile: workspaceUploadsMockFns.mockGetWorkspaceFile,
  updateContent: workspaceUploadsMockFns.mockUpdateWorkspaceFileContent,
  loadActive: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  notify: realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged,
  recordAudit: auditMockFns.mockRecordAudit,
  ...hoisted,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()

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

/** After a revert of v2: v2 is the source, v4 the new current version the write recorded. */
const getVersionAfterRevert = async (_file: unknown, number: number) =>
  number === 2
    ? version(2)
    : number === 4
      ? version(4, { source: 'revert', restoredFromVersion: 2, isCurrent: true })
      : current

describe('file version use cases', () => {
  beforeEach(() => {
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
      mocks.getVersion.mockImplementation(getVersionAfterRevert)

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
          action: 'file.reverted',
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

  describe('deleteWorkspaceFileVersion', () => {
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
  })
})
