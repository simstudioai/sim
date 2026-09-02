/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadLifecycle: vi.fn(),
  restoreStored: vi.fn(),
  getFile: vi.fn(),
  recordAudit: vi.fn(),
  notify: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_RESTORED: 'FILE_RESTORED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadWorkspaceFileLifecycleContext: mocks.loadLifecycle,
  restoreWorkspaceFile: mocks.restoreStored,
  getWorkspaceFile: mocks.getFile,
}))

import { restoreWorkspaceFileOperation } from '@/lib/workspace-files/application/restore-workspace-file'

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
  deletedAt: new Date('2026-01-01T00:00:00Z'),
}

/**
 * `restoreWorkspaceFile` renames on a collision and re-roots the file when its
 * folder is gone, so the post-restore record need not match the one the caller
 * deleted.
 */
const restoredFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'notes_restored.md',
  key: 'workspace/workspace-1/notes.md',
  path: '/api/files/serve/notes.md?context=workspace',
  size: 12,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  folderId: null,
  folderPath: null,
  deletedAt: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('restoreWorkspaceFileOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadLifecycle.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.restoreStored.mockResolvedValue(undefined)
    mocks.getFile.mockResolvedValue(restoredFile)
    mocks.notify.mockResolvedValue(undefined)
  })

  it('authorizes, restores, audits, and notifies once', async () => {
    const result = await restoreWorkspaceFileOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
    })

    expect(result).toEqual({ restored: true, file: restoredFile })
    expect(mocks.getFile).toHaveBeenCalledWith('workspace-1', 'file-1', { throwOnError: true })
    expect(mocks.restoreStored.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getFile.mock.invocationCallOrder[0]
    )
    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.restoreStored).toHaveBeenCalledWith('workspace-1', 'file-1')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        metadata: expect.objectContaining({ operation: 'files.restore' }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
    expect(mocks.recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notify.mock.invocationCallOrder[0]
    )
  })

  it('conceals an asserted-workspace mismatch before authorization', async () => {
    await expect(
      restoreWorkspaceFileOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.restoreStored).not.toHaveBeenCalled()
  })

  it('reports a file that vanished between the restore and the read-back as absent', async () => {
    mocks.getFile.mockResolvedValueOnce(null)

    await expect(
      restoreWorkspaceFileOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
