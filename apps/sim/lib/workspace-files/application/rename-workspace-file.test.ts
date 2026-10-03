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

import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'

const mocks = {
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  renameStored: workspaceFileManagerMockFns.mockRenameWorkspaceFile,
  notify: realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged,
  recordAudit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const canonical = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const mappedFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'new.csv',
  key: 'workspace/ws/file.csv',
  path: '/api/files/serve/file.csv',
  size: 42,
  type: 'text/csv',
  uploadedBy: 'uploader-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('renameWorkspaceFile application service', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(canonical)
    mocks.renameStored.mockResolvedValue(mappedFile)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.notify.mockResolvedValue(undefined)
  })

  it('conceals an asserted-workspace mismatch before authorization or mutation', async () => {
    await expect(
      renameWorkspaceFile.execute({
        principal: createSessionPrincipal(),
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2', name: 'new.csv' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.renameStored).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates an infrastructure read failure without classifying it as not found', async () => {
    const failure = new Error('database unavailable')
    mocks.loadContext.mockRejectedValueOnce(failure)

    await expect(
      renameWorkspaceFile.execute({
        principal: createSessionPrincipal(),
        input: { fileId: 'file-1', name: 'new.csv' },
      })
    ).rejects.toBe(failure)
  })
})
