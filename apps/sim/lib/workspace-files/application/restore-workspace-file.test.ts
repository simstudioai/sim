/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadLifecycle: vi.fn(),
  restoreStored: vi.fn(),
  recordAudit: vi.fn(),
  notify: vi.fn(),
  authorize: vi.fn(),
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
}))
vi.mock('@/lib/workspace-files/application/authorization', () => ({
  authorizeWorkspaceFileAccess: mocks.authorize,
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

describe('restoreWorkspaceFileOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadLifecycle.mockResolvedValue(context)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.restoreStored.mockResolvedValue(undefined)
    mocks.notify.mockResolvedValue(undefined)
  })

  it('authorizes, restores, audits, and notifies once', async () => {
    const result = await restoreWorkspaceFileOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
    })

    expect(result).toEqual({ restored: true })
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session' }),
      expect.objectContaining({ id: 'files.restore' }),
      expect.objectContaining({ workspaceId: 'workspace-1', fileId: 'file-1' })
    )
    expect(mocks.restoreStored).toHaveBeenCalledWith('workspace-1', 'file-1')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        metadata: expect.objectContaining({ operation: 'files.restore' }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an asserted-workspace mismatch before authorization', async () => {
    await expect(
      restoreWorkspaceFileOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.restoreStored).not.toHaveBeenCalled()
  })
})
