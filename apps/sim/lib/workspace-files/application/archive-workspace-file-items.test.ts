/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  events,
  mockLoadContext,
  mockResolvePermission,
  mockAssertItems,
  mockArchive,
  mockAudit,
  mockNotify,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockLoadContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockAssertItems: vi.fn(),
  mockArchive: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAssertItems,
  bulkArchiveWorkspaceFileItems: mockArchive,
  loadWorkspaceFileOperationContext: mockLoadContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DELETED: 'file.deleted', FOLDER_DELETED: 'folder.deleted' },
  AuditResourceType: { FILE: 'file', FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'

describe('archiveWorkspaceFileItemsOperation', () => {
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
    mockArchive.mockImplementation(async () => ({
      files: 1,
      folders: 0,
      fileIds: ['file-1'],
      folderIds: [],
    }))
  })

  it('preserves atomic bulk archive results and emits side effects once', async () => {
    const result = await archiveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', fileIds: ['file-1'] },
    })

    expect(result).toMatchObject({ deletedItems: { files: 1, folders: 0 } })
    expect(events).toEqual(['resolve', 'authorize', 'execute'])
    expect(mockArchive).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileIds: ['file-1'],
      folderIds: [],
    })
    expect(mockAssertItems).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileIds: ['file-1'],
      folderIds: [],
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('classifies a single missing file without notifying', async () => {
    mockArchive.mockResolvedValue({ files: 0, folders: 0, fileIds: [], folderIds: [] })
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'ws-1', fileIds: ['missing'] },
      })
    ).rejects.toThrow('File not found')
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('authorizes a delegated bulk selection without borrowing the first file scope', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
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
        input: { workspaceId: 'ws-1', fileIds: ['file-1', 'file-2'] },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockLoadContext).toHaveBeenCalledWith('ws-1')
    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockAssertItems).not.toHaveBeenCalled()
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('allows a file-scoped delegated principal to archive its one explicit file', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'ws-1',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      resourceScope: { fileId: 'file-1' },
    }

    await archiveWorkspaceFileItemsOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: ['file-1'] },
    })

    expect(mockResolvePermission).toHaveBeenCalledOnce()
  })

  it('denies a file-scoped delegated principal selecting a folder before validation', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
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
        input: { workspaceId: 'ws-1', folderIds: ['folder-1'] },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockAssertItems).not.toHaveBeenCalled()
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('audits and notifies only authoritative rows returned by the mutation', async () => {
    mockArchive.mockResolvedValue({
      files: 1,
      folders: 1,
      fileIds: ['file-2'],
      folderIds: ['folder-2'],
    })

    const result = await archiveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'ws-1',
        fileIds: ['file-1', 'file-2'],
        folderIds: ['folder-1'],
      },
    })

    expect(result).toMatchObject({ deletedItems: { files: 1, folders: 1 } })
    expect(mockAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ metadata: expect.objectContaining({ fileIds: ['file-2'] }) })
    )
    expect(mockAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ metadata: expect.objectContaining({ folderIds: ['folder-2'] }) })
    )
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('does not claim or notify a zero-row bulk mutation', async () => {
    mockArchive.mockResolvedValue({ files: 0, folders: 0, fileIds: [], folderIds: [] })

    const result = await archiveWorkspaceFileItemsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', fileIds: ['file-1', 'file-2'] },
    })

    expect(result).toMatchObject({ deletedItems: { files: 0, folders: 0 } })
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('rejects oversized selections after authorization and before storage', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'ws-1',
          fileIds: Array.from({ length: 1_001 }, (_, index) => `file-${index}`),
        },
      })
    ).rejects.toThrow('accept at most 1000')
    expect(events).toEqual(['resolve', 'authorize'])
    expect(mockArchive).not.toHaveBeenCalled()
  })
})
