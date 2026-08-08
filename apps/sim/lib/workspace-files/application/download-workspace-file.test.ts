/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadStream: vi.fn(),
  getFile: vi.fn(),
  loadContext: vi.fn(),
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DOWNLOADED: 'FILE_DOWNLOADED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.downloadStream,
}))

import {
  downloadWorkspaceFile,
  downloadWorkspaceFileStream,
} from '@/lib/workspace-files/application/download-workspace-file'

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
  name: 'report.pdf',
  key: 'workspace/workspace-1/report.pdf',
  size: 42,
  storageContext: 'workspace',
}

describe('workspace file downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
    mocks.downloadStream.mockResolvedValue(Readable.from(Buffer.from('pdf')))
  })

  it('returns the authoritative file and records its semantic download audit', async () => {
    await expect(
      downloadWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ file })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        action: 'FILE_DOWNLOADED',
        resourceId: 'file-1',
        resourceName: 'report.pdf',
        metadata: expect.objectContaining({
          operation: 'files.download',
          fileId: 'file-1',
          fileName: 'report.pdf',
          bytes: 42,
        }),
      })
    )
  })

  it('does not audit a streaming download when storage acquisition fails', async () => {
    const failure = new Error('storage unavailable')
    mocks.downloadStream.mockRejectedValueOnce(failure)

    await expect(
      downloadWorkspaceFileStream.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1' },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
