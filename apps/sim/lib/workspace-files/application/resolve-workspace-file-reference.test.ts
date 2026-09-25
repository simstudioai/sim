import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchBuffer: vi.fn(),
  getByName: vi.fn(),
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
  resolveStoredReference: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFileByName: mocks.getByName,
  loadActiveWorkspaceFileContext: mocks.loadContext,
  resolveWorkspaceFileReference: mocks.resolveStoredReference,
}))

import { defineWorkspaceOperation } from '@/lib/core/application'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'source.txt',
  key: 'workspace/workspace-1/source.txt',
  size: 12,
}
const context = {
  fileId: file.id,
  workspaceId: file.workspaceId,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

describe('workspace file reference application service', () => {
  beforeEach(() => {
    mocks.resolveStoredReference.mockResolvedValue(file)
    mocks.getByName.mockResolvedValue(file)
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('source'))
  })

  it('carries trusted chat scope into an authorized upload lookup', async () => {
    await resolveWorkspaceFileReference({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
      reference: 'uploads/source.txt',
      chatId: 'current-chat',
    })
    expect(mocks.resolveStoredReference).toHaveBeenCalledWith(
      file.workspaceId,
      'uploads/source.txt',
      { includeChatUploads: true, chatId: 'current-chat' }
    )
    expect(mocks.resolvePermission).toHaveBeenCalled()
  })

  it.each([
    fileOperations.rename,
    fileOperations.updateContent,
    fileOperations.move,
    fileOperations.delete,
    fileOperations.updateShare,
  ])('never admits a chat upload for $id', async (operation) => {
    await resolveWorkspaceFileReference({
      principal,
      operation,
      workspaceId: 'workspace-1',
      reference: 'uploads/photo.png',
    })

    expect(mocks.resolveStoredReference).toHaveBeenCalledWith(
      'workspace-1',
      'uploads/photo.png',
      undefined
    )
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', undefined)
  })

  it('resolves an exact name directly inside a canonical folder id', async () => {
    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.updateContent,
        workspaceId: 'workspace-1',
        reference: 'source.txt',
        folderId: 'folder-1',
      })
    ).resolves.toBe(file)

    expect(mocks.getByName).toHaveBeenCalledWith('workspace-1', 'source.txt', {
      folderId: 'folder-1',
    })
    expect(mocks.resolveStoredReference).not.toHaveBeenCalled()
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
  })

  it('fails before canonical loading for an unregistered operation object', async () => {
    const duplicateOperation = defineWorkspaceOperation({
      id: fileOperations.rename.id,
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
      capability: 'files.use',
    })

    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: duplicateOperation,
        workspaceId: 'workspace-1',
        reference: 'files/source.txt',
      })
    ).rejects.toThrow('No workspace file reference resolver is defined for files.rename')

    expect(mocks.resolveStoredReference).not.toHaveBeenCalled()
    expect(mocks.loadContext).not.toHaveBeenCalled()
  })
})
