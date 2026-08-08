/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  deleteStored: vi.fn(),
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DELETED: 'FILE_DELETED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  deleteWorkspaceFile: mocks.deleteStored,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

describe('deleteWorkspaceFileOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.deleteStored.mockResolvedValue(undefined)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.notify.mockResolvedValue(undefined)
  })

  it('authorizes, archives, audits, and notifies once', async () => {
    const result = await deleteWorkspaceFileOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
    })

    expect(result).toEqual({ id: 'file-1', workspaceId: 'workspace-1', deleted: true })
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', { includeDeleted: undefined })
    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.deleteStored).toHaveBeenCalledWith('workspace-1', 'file-1')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        metadata: expect.objectContaining({ operation: 'files.delete' }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
    expect(mocks.recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notify.mock.invocationCallOrder[0]
    )
  })

  it('does not emit side effects when storage fails', async () => {
    const failure = new Error('storage unavailable')
    mocks.deleteStored.mockRejectedValueOnce(failure)

    await expect(
      deleteWorkspaceFileOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1' },
      })
    ).rejects.toBe(failure)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
