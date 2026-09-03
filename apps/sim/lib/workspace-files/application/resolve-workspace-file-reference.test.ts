/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchBuffer: vi.fn(),
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
    expect(mocks.resolveStoredReference).toHaveBeenCalledWith(
      'workspace-1',
      'files/source.txt',
      undefined
    )
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', undefined)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
  })

  /**
   * Chat uploads are hidden from every listing, so an explicit `uploads/<name>`
   * reference is the one way to one — and only a read may take it. The opt-in
   * rides both the stored lookup and the canonical context load, so a chat
   * upload can neither be found nor authorized for anything but reading.
   */
  it('lets a content read reach a chat upload by its uploads/<name> reference', async () => {
    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.readContent,
        workspaceId: 'workspace-1',
        reference: 'uploads/photo.png',
      })
    ).resolves.toBe(file)

    expect(mocks.resolveStoredReference).toHaveBeenCalledWith('workspace-1', 'uploads/photo.png', {
      includeChatUploads: true,
    })
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', { includeChatUploads: true })
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

  it('reads a chat upload by its uploads/<name> reference and returns its content', async () => {
    const upload = {
      ...file,
      id: 'wf_upload',
      name: 'photo (2).png',
      storageContext: 'mothership' as const,
      vfsNamespace: 'uploads' as const,
    }
    mocks.resolveStoredReference.mockResolvedValue(upload)
    mocks.loadContext.mockResolvedValue({ ...context, fileId: upload.id })
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('png-bytes'))

    await expect(
      readWorkspaceFileReference({
        principal,
        workspaceId: 'workspace-1',
        reference: 'uploads/photo%20(2).png',
        maxBytes: 512,
      })
    ).resolves.toEqual({ file: upload, content: Buffer.from('png-bytes') })

    expect(mocks.resolveStoredReference).toHaveBeenCalledWith(
      'workspace-1',
      'uploads/photo%20(2).png',
      { includeChatUploads: true }
    )
    expect(mocks.loadContext).toHaveBeenCalledWith('wf_upload', { includeChatUploads: true })
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(upload, { maxBytes: 512 })
  })

  it('fails before canonical loading for an unregistered operation object', async () => {
    const duplicateOperation = defineWorkspaceOperation({
      id: fileOperations.rename.id,
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
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
