/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  events,
  mockLoadContext,
  mockResolvePermission,
  mockAssertItems,
  mockMove,
  mockAudit,
  mockNotify,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockLoadContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockAssertItems: vi.fn(),
  mockMove: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAssertItems,
  loadWorkspaceFileOperationContext: mockLoadContext,
  moveWorkspaceFileItems: mockMove,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_MOVED: 'file.moved', FOLDER_MOVED: 'folder.moved' },
  AuditResourceType: { FILE: 'file', FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'

describe('moveWorkspaceFileItemsOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockLoadContext.mockImplementation(async () => {
      events.push('resolve')
      return {
        workspaceId: 'ws-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'owner-1',
      }
    })
    mockResolvePermission.mockImplementation(async () => {
      events.push('authorize')
      return 'write'
    })
    mockAssertItems.mockImplementation(async () => {
      events.push('execute')
    })
    mockMove.mockImplementation(async () => ({
      movedFiles: 2,
      movedFolders: 1,
      movedFileIds: ['file-1', 'file-2'],
      movedFolderIds: ['folder-1'],
    }))
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

    expect(result).toMatchObject({ movedItems: { files: 2, folders: 1 } })
    expect(events).toEqual(['resolve', 'authorize', 'execute'])
    expect(mockAssertItems).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileIds: ['file-1', 'file-2'],
      folderIds: ['folder-1'],
    })
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

  it('allows authorization to carry a resource ID only for one explicit file', async () => {
    mockMove.mockResolvedValue({
      movedFiles: 1,
      movedFolders: 0,
      movedFileIds: ['file-1'],
      movedFolderIds: [],
    })

    await moveWorkspaceFileItemsOperation.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'ws-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        resourceScope: { fileId: 'file-1' },
      },
      input: { workspaceId: 'ws-1', fileIds: ['file-1'], targetFolderId: null },
    })

    expect(mockResolvePermission).toHaveBeenCalledOnce()
  })

  it('does not audit or notify requested IDs absent from the mutation result', async () => {
    mockMove.mockResolvedValue({
      movedFiles: 0,
      movedFolders: 0,
      movedFileIds: [],
      movedFolderIds: [],
    })

    const result = await moveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', fileIds: ['file-1'], targetFolderId: null },
    })

    expect(result).toMatchObject({ movedItems: { files: 0, folders: 0 } })
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('authorizes before rejecting an empty selection without touching storage', async () => {
    await expect(
      moveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1' },
      })
    ).rejects.toThrow('At least one file or folder must be selected')
    expect(events).toEqual(['resolve', 'authorize'])
    expect(mockMove).not.toHaveBeenCalled()
  })

  it('rejects oversized selections after authorization', async () => {
    await expect(
      moveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'ws-1',
          folderIds: Array.from({ length: 1_001 }, (_, index) => `folder-${index}`),
        },
      })
    ).rejects.toThrow('accept at most 1000')
    expect(events).toEqual(['resolve', 'authorize'])
    expect(mockMove).not.toHaveBeenCalled()
  })
})
