/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchBuffer: vi.fn(),
  getByName: vi.fn(),
  listFiles: vi.fn(),
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
  listWorkspaceFiles: mocks.listFiles,
  loadActiveWorkspaceFileContext: mocks.loadContext,
  resolveWorkspaceFileReference: mocks.resolveStoredReference,
}))

import { defineWorkspaceOperation } from '@/lib/core/application'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  createWorkspaceFileReferenceResolver,
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
    mocks.listFiles.mockResolvedValue([file])
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
    fileOperations.readMetadata,
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

  it('resolves metadata at read permission without acquiring file content', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.readMetadata,
        workspaceId: file.workspaceId,
        reference: 'files/source.txt',
      })
    ).resolves.toBe(file)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('keeps grouped exact lookups fresh without loading a fallback listing', async () => {
    const resolveReference = createWorkspaceFileReferenceResolver({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
      chatId: 'current-chat',
    })
    expect(mocks.resolveStoredReference).not.toHaveBeenCalled()

    await Promise.all(['wf_source', 'files/source.txt', 'uploads/source.txt'].map(resolveReference))

    expect(mocks.listFiles).not.toHaveBeenCalled()
    expect(mocks.resolveStoredReference).toHaveBeenCalledTimes(3)
    expect(mocks.resolveStoredReference).toHaveBeenLastCalledWith(
      file.workspaceId,
      'uploads/source.txt',
      {
        includeChatUploads: true,
        chatId: 'current-chat',
        loadFallbackFiles: expect.any(Function),
      }
    )
    expect(mocks.loadContext).toHaveBeenCalledTimes(3)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(3)
  })

  it('shares one lazy fallback listing across concurrent misses while authorizing each result', async () => {
    mocks.resolveStoredReference.mockImplementation(async (_workspaceId, _reference, options) => {
      const files = await options.loadFallbackFiles()
      return files[0]
    })
    const resolveReference = createWorkspaceFileReferenceResolver({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
    })
    expect(mocks.listFiles).not.toHaveBeenCalled()

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => resolveReference(`legacy-${index}.txt`))
    )

    expect(results).toHaveLength(20)
    expect(mocks.listFiles).toHaveBeenCalledExactlyOnceWith(file.workspaceId, {
      throwOnError: true,
    })
    expect(mocks.loadContext).toHaveBeenCalledTimes(20)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(20)
  })

  it('does not reuse authorization when a grouped lookup loses access', async () => {
    mocks.resolveStoredReference.mockImplementation(async (_workspaceId, _reference, options) => {
      return (await options.loadFallbackFiles())[0]
    })
    const resolveReference = createWorkspaceFileReferenceResolver({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
    })
    await resolveReference('source.txt')
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(resolveReference('source.txt')).rejects.toThrow(
      'Insufficient workspace permissions'
    )
    expect(mocks.listFiles).toHaveBeenCalledTimes(1)
    expect(mocks.loadContext).toHaveBeenCalledTimes(2)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
  })

  it('reloads canonical context when a fallback record is deleted or moved out of scope', async () => {
    mocks.resolveStoredReference.mockImplementation(async (_workspaceId, _reference, options) => {
      return (await options.loadFallbackFiles())[0]
    })
    const resolveReference = createWorkspaceFileReferenceResolver({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
    })
    await resolveReference('source.txt')
    mocks.loadContext.mockResolvedValueOnce(null)
    await expect(resolveReference('source.txt')).rejects.toMatchObject({ code: 'not_found' })
    mocks.loadContext.mockResolvedValueOnce({ ...context, workspaceId: 'other-workspace' })
    await expect(resolveReference('source.txt')).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.listFiles).toHaveBeenCalledTimes(1)
    expect(mocks.loadContext).toHaveBeenCalledTimes(3)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback listings local to each resolver group', async () => {
    mocks.resolveStoredReference.mockImplementation(async (_workspaceId, _reference, options) => {
      return (await options.loadFallbackFiles())[0]
    })
    const input = {
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
    }
    await createWorkspaceFileReferenceResolver(input)('source.txt')
    await createWorkspaceFileReferenceResolver(input)('source.txt')
    expect(mocks.listFiles).toHaveBeenCalledTimes(2)
  })

  it('propagates fallback infrastructure failures without caching a not-found result', async () => {
    const failure = new Error('Database unavailable')
    mocks.listFiles.mockRejectedValue(failure)
    mocks.resolveStoredReference.mockImplementation(async (_workspaceId, _reference, options) => {
      return (await options.loadFallbackFiles())[0]
    })
    const resolveReference = createWorkspaceFileReferenceResolver({
      principal,
      operation: fileOperations.readContent,
      workspaceId: file.workspaceId,
    })
    await expect(resolveReference('source.txt')).rejects.toBe(failure)
    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('refuses metadata after access is revoked without acquiring file content', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    await expect(
      resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.readMetadata,
        workspaceId: file.workspaceId,
        reference: 'files/source.txt',
      })
    ).rejects.toThrow('Insufficient workspace permissions')
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
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
