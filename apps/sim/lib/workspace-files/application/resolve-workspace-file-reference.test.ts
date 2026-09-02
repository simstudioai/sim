/**
 * @vitest-environment node
 */
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
import {
  readWorkspaceFileReference,
  resolveWorkspaceFileReference,
} from '@/lib/workspace-files/application/resolve-workspace-file-reference'

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
    vi.clearAllMocks()
    mocks.resolveStoredReference.mockResolvedValue(file)
    mocks.getByName.mockResolvedValue(file)
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('source'))
  })

  it('uses one fixed semantic use case for an authorized reference lookup', async () => {
    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.rename,
        workspaceId: 'workspace-1',
        reference: 'files/source.txt',
      })
    ).resolves.toBe(file)

    expect(mocks.resolveStoredReference).toHaveBeenCalledTimes(1)
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
  })

  it('reads a referenced file with one canonical load and authorization', async () => {
    await expect(
      readWorkspaceFileReference({
        principal,
        workspaceId: 'workspace-1',
        reference: 'files/source.txt',
        maxBytes: 512,
      })
    ).resolves.toEqual({ file, content: Buffer.from('source') })

    expect(mocks.resolveStoredReference).toHaveBeenCalledTimes(1)
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(file, { maxBytes: 512 })
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

  it('reads an exact name directly inside a canonical folder id', async () => {
    await expect(
      readWorkspaceFileReference({
        principal,
        workspaceId: 'workspace-1',
        reference: 'source.txt',
        folderId: 'folder-1',
        maxBytes: 512,
      })
    ).resolves.toEqual({ file, content: Buffer.from('source') })

    expect(mocks.getByName).toHaveBeenCalledWith('workspace-1', 'source.txt', {
      folderId: 'folder-1',
    })
    expect(mocks.resolveStoredReference).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(file, { maxBytes: 512 })
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
