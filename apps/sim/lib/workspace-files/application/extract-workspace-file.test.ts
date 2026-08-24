/**
 * @vitest-environment node
 */
import { Buffer } from 'buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  archiveFolderIfEmpty: vi.fn(),
  atomicallyClaim: vi.fn(),
  createFolder: vi.fn(),
  decompress: vi.fn(),
  fetchBuffer: vi.fn(),
  getFile: vi.fn(),
  getSecretProvenance: vi.fn(),
  loadContext: vi.fn(),
  notify: vi.fn(),
  releaseLease: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

vi.mock('@/lib/core/idempotency/service', () => ({
  IdempotencyService: class MockIdempotencyService {
    atomicallyClaim(...args: unknown[]) {
      return mocks.atomicallyClaim(...args)
    }

    release(...args: unknown[]) {
      return mocks.releaseLease(...args)
    }
  },
}))

vi.mock('@/lib/uploads/archive', () => ({
  decompressArchiveBufferToWorkspaceFiles: mocks.decompress,
  MAX_ARCHIVE_BYTES: 100 * 1024 * 1024,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  archiveWorkspaceFileFolderIfEmpty: mocks.archiveFolderIfEmpty,
  createWorkspaceFileFolder: mocks.createFolder,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mocks.getSecretProvenance,
}))

import { extractWorkspaceFile } from '@/lib/workspace-files/application/extract-workspace-file'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'bundle.zip',
  key: 'workspace/workspace-1/bundle.zip',
  size: 256,
  folderPath: 'Projects/Imports',
  storageContext: 'workspace' as const,
  folderId: 'folder-imports',
}

describe('extractWorkspaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getFile.mockResolvedValue(file)
    mocks.createFolder.mockResolvedValue({
      id: 'folder-bundle',
      name: 'bundle',
      path: 'Projects/Imports/bundle',
    })
    mocks.archiveFolderIfEmpty.mockResolvedValue(true)
    mocks.atomicallyClaim.mockResolvedValue({
      claimed: true,
      normalizedKey: 'workspace-file:extract:workspace-1:file-1',
      storageMethod: 'database',
      claimToken: 'claim-1',
    })
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('zip'))
    mocks.getSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.decompress.mockImplementation(async (_content, options) => {
      await options.prepareRootFolder(vi.fn())
      return {
        extracted: [{ id: 'extracted-1' }, { id: 'extracted-2' }],
        skipped: 1,
        skippedUnsafePaths: [],
      }
    })
    mocks.notify.mockResolvedValue(undefined)
    mocks.releaseLease.mockResolvedValue(undefined)
  })

  it('extracts into a same-name folder beside the archive', async () => {
    const validateRootFolderSegments = vi.fn()
    mocks.decompress.mockImplementationOnce(async (_content, options) => {
      await options.prepareRootFolder(validateRootFolderSegments)
      return {
        extracted: [{ id: 'extracted-1' }, { id: 'extracted-2' }],
        skipped: 1,
        skippedUnsafePaths: [],
      }
    })
    mocks.createFolder.mockImplementationOnce(async (options) => {
      options.validateResolvedName('bundle')
      return {
        id: 'folder-bundle',
        name: 'bundle',
        path: 'Projects/Imports/bundle',
      }
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({
      folderName: 'bundle',
      folderDisplayPath: 'Projects/Imports/bundle',
      extractedCount: 2,
      skippedCount: 1,
    })

    expect(mocks.createFolder).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'bundle',
      parentId: 'folder-imports',
      exactName: false,
      validateResolvedName: expect.any(Function),
    })
    expect(validateRootFolderSegments).toHaveBeenCalledWith(['Projects', 'Imports', 'bundle'])
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(file, { maxBytes: 100 * 1024 * 1024 })
    expect(mocks.decompress).toHaveBeenCalledWith(Buffer.from('zip'), {
      workspaceId: 'workspace-1',
      principal,
      rootFolderSegments: ['Projects', 'Imports', 'bundle'],
      prepareRootFolder: expect.any(Function),
      signal: expect.any(AbortSignal),
      skipNoiseEntries: true,
      secretProvenance: { status: 'exact', entries: [] },
      notifyWorkspaceChange: false,
    })
    expect(mocks.atomicallyClaim).toHaveBeenCalledWith('extract', 'workspace-1:file-1')
    expect(mocks.releaseLease).toHaveBeenCalledWith(
      'workspace-file:extract:workspace-1:file-1',
      'database',
      'claim-1'
    )
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
  })

  it('rejects non-zip files before reading storage', async () => {
    mocks.getFile.mockResolvedValue({ ...file, name: 'bundle.txt' })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Only .zip files can be unzipped' })

    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    expect(mocks.decompress).not.toHaveBeenCalled()
  })

  it('rejects a second extraction while the same archive is already being extracted', async () => {
    mocks.atomicallyClaim
      .mockResolvedValueOnce({
        claimed: true,
        normalizedKey: 'workspace-file:extract:workspace-1:file-1',
        storageMethod: 'database',
        claimToken: 'claim-1',
      })
      .mockResolvedValueOnce({
        claimed: false,
        normalizedKey: 'workspace-file:extract:workspace-1:file-1',
        storageMethod: 'database',
        existingResult: { status: 'in-progress' },
      })
    let releaseFetch: ((value: Buffer) => void) | undefined
    mocks.fetchBuffer.mockImplementationOnce(
      () =>
        new Promise<Buffer>((resolve) => {
          releaseFetch = resolve
        })
    )

    const firstExtraction = extractWorkspaceFile.execute({
      principal,
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
    })
    await vi.waitFor(() => expect(mocks.fetchBuffer).toHaveBeenCalledOnce())

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'This archive is already being unzipped',
    })

    releaseFetch?.(Buffer.from('zip'))
    await expect(firstExtraction).resolves.toMatchObject({ extractedCount: 2 })
    expect(mocks.atomicallyClaim).toHaveBeenCalledTimes(2)
    expect(mocks.releaseLease).toHaveBeenCalledOnce()
  })

  it('rejects extraction when another server owns the archive lease', async () => {
    mocks.atomicallyClaim.mockResolvedValueOnce({
      claimed: false,
      normalizedKey: 'workspace-file:extract:workspace-1:file-1',
      storageMethod: 'database',
      existingResult: { status: 'in-progress' },
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'This archive is already being unzipped',
    })

    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.releaseLease).not.toHaveBeenCalled()
  })

  it('uses a suffixed destination instead of merging into a stranded folder', async () => {
    mocks.createFolder.mockResolvedValueOnce({
      id: 'folder-bundle-3',
      name: 'bundle (3)',
      path: 'Projects/Imports/bundle (3)',
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({
      folderName: 'bundle (3)',
      folderDisplayPath: 'Projects/Imports/bundle (3)',
      extractedCount: 2,
      skippedCount: 1,
    })

    expect(mocks.createFolder).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'bundle', exactName: false })
    )
  })

  it('only removes the destination folder when it is still empty after extraction fails', async () => {
    mocks.decompress.mockImplementationOnce(async (_content, options) => {
      await options.prepareRootFolder()
      throw new Error('invalid archive')
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toThrow('invalid archive')

    expect(mocks.archiveFolderIfEmpty).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      folderId: 'folder-bundle',
    })
    expect(mocks.notify).toHaveBeenCalledOnce()
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
  })

  /** Fires the deadline the way `AbortSignal.timeout` does: `reason` is what gets thrown. */
  function expireDeadline(signal: AbortSignal): unknown {
    const reason = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    Object.defineProperty(signal, 'aborted', { value: true })
    Object.defineProperty(signal, 'reason', { value: reason })
    return reason
  }

  it('reports a budget overrun as a caller-fixable error, not the raw abort', async () => {
    mocks.decompress.mockImplementationOnce(async (_content, options) => {
      await options.prepareRootFolder()
      throw expireDeadline(options.signal)
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining('took too long and was cancelled'),
    })

    expect(mocks.archiveFolderIfEmpty).toHaveBeenCalledOnce()
  })

  it('keeps the real cause when a failure races the deadline', async () => {
    // The signal stays aborted for the rest of the request, so an unrelated mid-entry
    // failure after the timer fires must not be relabelled as a timeout.
    mocks.decompress.mockImplementationOnce(async (_content, options) => {
      await options.prepareRootFolder()
      expireDeadline(options.signal)
      throw Object.assign(new Error('Archive entry "a.txt" could not be decompressed'), {
        name: 'ArchiveError',
        reason: 'invalid',
      })
    })

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      message: expect.stringContaining('could not be decompressed'),
    })
  })

  it('leaves a destination folder that gained collaborators content during rollback', async () => {
    mocks.decompress.mockImplementationOnce(async (_content, options) => {
      await options.prepareRootFolder()
      throw new Error('storage quota exceeded')
    })
    mocks.archiveFolderIfEmpty.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'Folder is not empty')
    )

    await expect(
      extractWorkspaceFile.execute({
        principal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toThrow('storage quota exceeded')

    expect(mocks.archiveFolderIfEmpty).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-bundle' })
    )
    expect(mocks.notify).toHaveBeenCalledOnce()
  })

  /**
   * The widening: API-key principals reach extraction because it grants nothing
   * `files.create` and `files.upload.create` do not already grant them at the
   * same `write` role. It only collapses many calls into one.
   */
  it.each([
    { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
  ] as const)('allows $kind to extract', async (apiKeyPrincipal) => {
    await expect(
      extractWorkspaceFile.execute({
        principal: apiKeyPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({ extractedCount: 2 })
  })

  /**
   * Delegated services stay out. No copilot or executor caller exists today and
   * admitting one is a separate decision, so the widening must not quietly
   * include them.
   */
  it('still rejects a delegated principal before loading the file', async () => {
    await expect(
      extractWorkspaceFile.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'delegation-1',
          audience: 'sim:workspace-files',
          issuedAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: new Date('2999-01-01T00:00:00Z'),
        },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })
})
