/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, mockMove, mockAudit, mockNotify } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockMove: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: mockAuthorize,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAuthorize,
  moveWorkspaceFileItems: mockMove,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_MOVED: 'file.moved', FOLDER_MOVED: 'folder.moved' },
  AuditResourceType: { FILE: 'file', FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

describe('moveWorkspaceFileItemsOperation', () => {
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
    mockMove.mockResolvedValue({ movedFiles: 2, movedFolders: 1 })
  })

  it('uses the atomic manager primitive and records each semantic category once', async () => {
    const result = await moveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'ws-1',
        fileIds: ['file-1', 'file-2'],
        folderIds: ['folder-1'],
        targetFolderId: null,
      },
    })

    expect(result).toEqual({ movedItems: { files: 2, folders: 1 } })
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      fileOperations.move,
      'ws-1',
      'file-1'
    )
    expect(mockMove).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileIds: ['file-1', 'file-2'],
      folderIds: ['folder-1'],
      targetFolderId: null,
      targetFolderPath: undefined,
    })
    expect(mockAudit).toHaveBeenCalledTimes(2)
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('fails before touching storage when the selection is empty', async () => {
    await expect(
      moveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1' },
      })
    ).rejects.toThrow('At least one file or folder must be selected')
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockMove).not.toHaveBeenCalled()
  })

  it('rejects oversized selections before authorization', async () => {
    await expect(
      moveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'ws-1',
          folderIds: Array.from({ length: 1_001 }, (_, index) => `folder-${index}`),
        },
      })
    ).rejects.toThrow('accept at most 1000')
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockMove).not.toHaveBeenCalled()
  })
})
