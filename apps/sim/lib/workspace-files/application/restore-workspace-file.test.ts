import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

import { restoreWorkspaceFileOperation } from '@/lib/workspace-files/application/restore-workspace-file'

const mocks = {
  loadLifecycle: workspaceFileManagerMockFns.mockLoadWorkspaceFileLifecycleContext,
  restoreStored: workspaceFileManagerMockFns.mockRestoreWorkspaceFile,
  getFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  notify: realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged,
  recordAudit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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
    mocks.loadLifecycle.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.restoreStored.mockResolvedValue(undefined)
    mocks.getFile.mockResolvedValue(restoredFile)
    mocks.notify.mockResolvedValue(undefined)
  })

  it('conceals an asserted-workspace mismatch before authorization', async () => {
    await expect(
      restoreWorkspaceFileOperation.execute({
        principal: createSessionPrincipal(),
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.restoreStored).not.toHaveBeenCalled()
  })
})
