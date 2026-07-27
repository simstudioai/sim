/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecrementStorageUsageForBillingContextInTx,
  mockDeleteFile,
  mockGetWorkspaceWithOwner,
  mockHasCloudStorage,
  mockHeadObject,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
  mockUploadFile,
} = vi.hoisted(() => ({
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockHeadObject: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/s3/'),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: mockDeleteFile,
  downloadFile: vi.fn(),
  hasCloudStorage: mockHasCloudStorage,
  headObject: mockHeadObject,
  uploadFile: mockUploadFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import {
  deleteWorkspaceFile,
  registerUploadedWorkspaceFile,
  restoreWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const STORAGE_CONTEXT = {
  workspaceId: '7727ef3f-8cf6-4686-b063-2bb006a10785',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

const FILE_ROW = {
  id: 'wf_file',
  key: 'workspace/7727ef3f-8cf6-4686-b063-2bb006a10785/123-abc-note.txt',
  userId: 'user-1',
  workspaceId: '7727ef3f-8cf6-4686-b063-2bb006a10785',
  folderId: null,
  context: 'workspace',
  chatId: null,
  originalName: 'note.txt',
  displayName: 'note.txt',
  contentType: 'text/plain',
  size: 5,
  deletedAt: null,
  uploadedAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
}

describe('workspace file metadata and storage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockHasCloudStorage.mockReturnValue(false)
    mockHeadObject.mockResolvedValue({ size: FILE_ROW.size })
    mockUploadFile.mockResolvedValue({ key: FILE_ROW.key })
    mockGetWorkspaceWithOwner.mockResolvedValue({ archivedAt: null })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(10)
    mockDecrementStorageUsageForBillingContextInTx.mockResolvedValue(undefined)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
  })

  it('cleans up a newly uploaded object when atomic metadata finalization rolls back', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('payer update failed')
    )

    await expect(
      uploadWorkspaceFile(
        FILE_ROW.workspaceId,
        FILE_ROW.userId,
        Buffer.from('hello'),
        FILE_ROW.originalName,
        FILE_ROW.contentType
      )
    ).rejects.toThrow('payer update failed')

    expect(mockDeleteFile).toHaveBeenCalledWith({ key: FILE_ROW.key, context: 'workspace' })
    expect(mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteFile.mock.invocationCallOrder[0]
    )
  })

  it('charges only the direct-registration call that wins the metadata insert race', async () => {
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([FILE_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([])

    const [first, second] = await Promise.all([
      registerUploadedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        userId: FILE_ROW.userId,
        key: FILE_ROW.key,
        originalName: FILE_ROW.originalName,
        contentType: FILE_ROW.contentType,
      }),
      registerUploadedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        userId: FILE_ROW.userId,
        key: FILE_ROW.key,
        originalName: FILE_ROW.originalName,
        contentType: FILE_ROW.contentType,
      }),
    ])

    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('does not delete an object when a registration race finds a different operation', async () => {
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...FILE_ROW, userId: 'different-user' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      registerUploadedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        userId: FILE_ROW.userId,
        key: FILE_ROW.key,
        originalName: FILE_ROW.originalName,
        contentType: FILE_ROW.contentType,
      })
    ).rejects.toThrow('already registered to a different workspace file operation')

    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('does not delete a direct-upload object when atomic finalization rolls back', async () => {
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('Storage limit exceeded')
    )

    await expect(
      registerUploadedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        userId: FILE_ROW.userId,
        key: FILE_ROW.key,
        originalName: FILE_ROW.originalName,
        contentType: FILE_ROW.contentType,
      })
    ).rejects.toThrow('Storage limit exceeded')

    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockHeadObject.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
  })

  it('archives metadata without changing stored-byte counters', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])

    await deleteWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)

    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('archives exactly once across replays', async () => {
    const archivedFile = {
      ...FILE_ROW,
      deletedAt: new Date('2026-07-02T00:00:00.000Z'),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([archivedFile])
    dbChainMockFns.returning.mockResolvedValueOnce([archivedFile])

    await deleteWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)
    await deleteWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)

    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('restores metadata without changing stored-byte counters', async () => {
    const archivedFile = {
      ...FILE_ROW,
      deletedAt: new Date('2026-07-02T00:00:00.000Z'),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([archivedFile])
    dbChainMockFns.returning.mockResolvedValueOnce([archivedFile])

    await restoreWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)

    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('restores exactly once across replays', async () => {
    const archivedFile = {
      ...FILE_ROW,
      deletedAt: new Date('2026-07-02T00:00:00.000Z'),
    }
    const restoredFile = { ...FILE_ROW, originalName: 'note-restored.txt' }
    dbChainMockFns.limit.mockResolvedValueOnce([archivedFile]).mockResolvedValueOnce([restoredFile])
    dbChainMockFns.returning.mockResolvedValueOnce([restoredFile])

    await restoreWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)
    await restoreWorkspaceFile(FILE_ROW.workspaceId, FILE_ROW.id)

    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('uploads an overwrite before atomically swapping the locked row and exact delta', async () => {
    const concurrentFile = { ...FILE_ROW, size: 7 }
    const replacementKey = `${FILE_ROW.key}-replacement`
    const updatedFile = {
      ...concurrentFile,
      key: replacementKey,
      size: 10,
      updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([concurrentFile])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: replacementKey })

    const updated = await updateWorkspaceFileContent(
      FILE_ROW.workspaceId,
      FILE_ROW.id,
      FILE_ROW.userId,
      Buffer.alloc(10),
      'application/octet-stream'
    )

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        customKey: expect.not.stringMatching(new RegExp(`${FILE_ROW.key}$`)),
        persistMetadata: false,
      })
    )
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.any(Object),
      STORAGE_CONTEXT,
      3
    )
    expect(mockDeleteFile).toHaveBeenCalledWith({ key: FILE_ROW.key, context: 'workspace' })
    expect(updated.key).toBe(replacementKey)
    expect(mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteFile.mock.invocationCallOrder[0]
    )
  })

  it('cleans up only the new overwrite object when atomic finalization fails', async () => {
    const replacementKey = `${FILE_ROW.key}-replacement`
    const updatedFile = { ...FILE_ROW, key: replacementKey, size: 10 }
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([FILE_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: replacementKey })
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('Storage limit exceeded')
    )

    await expect(
      updateWorkspaceFileContent(
        FILE_ROW.workspaceId,
        FILE_ROW.id,
        FILE_ROW.userId,
        Buffer.alloc(10)
      )
    ).rejects.toThrow('Storage limit exceeded')

    expect(mockDeleteFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).toHaveBeenCalledWith({ key: replacementKey, context: 'workspace' })
  })
})
