import { Buffer } from 'buffer'
import {
  createExecutorPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const hoisted = vi.hoisted(() => ({
  atomicallyClaim: vi.fn(),
  decompress: vi.fn(),
  releaseLease: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/core/idempotency/service', () => ({
  IdempotencyService: class MockIdempotencyService {
    atomicallyClaim(...args: unknown[]) {
      return hoisted.atomicallyClaim(...args)
    }

    release(...args: unknown[]) {
      return hoisted.releaseLease(...args)
    }
  },
}))

vi.mock('@/lib/uploads/archive', () => ({
  decompressArchiveBufferToWorkspaceFiles: hoisted.decompress,
  MAX_ARCHIVE_BYTES: 100 * 1024 * 1024,
}))

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { extractWorkspaceFile } from '@/lib/workspace-files/application/extract-workspace-file'

const mocks = {
  getSecretProvenance:
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
  fetchBuffer: workspaceFileManagerMockFns.mockFetchWorkspaceFileBuffer,
  getFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  notify: realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged,
  ...hoisted,
  createFolder: workspaceFileFoldersMockFns.mockCreateWorkspaceFileFolder,
  archiveFolderIfEmpty: workspaceFileFoldersMockFns.mockArchiveWorkspaceFileFolderIfEmpty,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()
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
  it.each([createPersonalApiKeyPrincipal(), createWorkspaceApiKeyPrincipal()] as const)(
    'allows $kind to extract',
    async (apiKeyPrincipal) => {
      await expect(
        extractWorkspaceFile.execute({
          principal: apiKeyPrincipal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
        })
      ).resolves.toMatchObject({ extractedCount: 2 })
    }
  )

  it('rejects a non-Copilot delegated principal before loading the file', async () => {
    await expect(
      extractWorkspaceFile.execute({
        principal: createExecutorPrincipal({
          audience: 'sim:workspace-files',
          expiresAt: new Date('2999-01-01T00:00:00Z'),
        }),
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })
})
