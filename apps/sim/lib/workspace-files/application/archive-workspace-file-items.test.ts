/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, mockArchive, mockAudit, mockNotify } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockArchive: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: mockAuthorize,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAuthorize,
  bulkArchiveWorkspaceFileItems: mockArchive,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DELETED: 'file.deleted', FOLDER_DELETED: 'folder.deleted' },
  AuditResourceType: { FILE: 'file', FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

describe('archiveWorkspaceFileItemsOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorize.mockResolvedValue({
      context: {
        workspaceId: 'ws-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'owner-1',
      },
      attribution: { attributedUserId: 'user-1', actor: { kind: 'session', userId: 'user-1' } },
    })
    mockArchive.mockResolvedValue({ files: 1, folders: 0 })
  })

  it('preserves atomic bulk archive results and emits side effects once', async () => {
    const result = await archiveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', fileIds: ['file-1'] },
    })

    expect(result).toEqual({ deletedItems: { files: 1, folders: 0 } })
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      fileOperations.delete,
      'ws-1',
      'file-1'
    )
    expect(mockArchive).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileIds: ['file-1'],
      folderIds: [],
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('classifies a single missing file without notifying', async () => {
    mockArchive.mockResolvedValue({ files: 0, folders: 0 })
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', fileIds: ['missing'] },
      })
    ).rejects.toThrow('File not found')
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('rejects oversized selections before authorization', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'ws-1',
          fileIds: Array.from({ length: 1_001 }, (_, index) => `file-${index}`),
        },
      })
    ).rejects.toThrow('accept at most 1000')
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockArchive).not.toHaveBeenCalled()
  })
})
