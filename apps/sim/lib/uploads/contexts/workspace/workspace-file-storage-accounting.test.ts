/**
 * @vitest-environment node
 */
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { describeError } from '@sim/utils/errors'
import { PASTE_LIMITS } from '@sim/utils/paste'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecrementStorageUsageForBillingContextInTx,
  mockDeleteFile,
  mockEnqueueWorkspaceFileStorageCleanup,
  mockEnqueueWorkspaceFileLiveDocReconciliation,
  mockGetWorkspaceWithOwner,
  mockHasCloudStorage,
  mockHeadObject,
  mockAcquireFolderMutationLock,
  mockAssertWorkspaceFileFolderTarget,
  mockIncrementStorageUsageForBillingContextInTx,
  mockLoadActiveFolderPathIndex,
  mockInitializeWorkspaceFileSecretProvenanceInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockNotifyWorkspaceFilesChanged,
  mockProcessWorkspaceFileStorageCleanupNow,
  mockProcessWorkspaceFileLiveDocReconciliationNow,
  mockResolveStorageBillingContext,
  mockResolveFolderPathFromIndex,
  mockResolveWorkspaceFileFolderTarget,
  mockReplaceWorkspaceFileSecretProvenanceInTx,
  mockUploadFile,
} = vi.hoisted(() => ({
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockEnqueueWorkspaceFileStorageCleanup: vi.fn(),
  mockEnqueueWorkspaceFileLiveDocReconciliation: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockHeadObject: vi.fn(),
  mockAcquireFolderMutationLock: vi.fn(),
  mockAssertWorkspaceFileFolderTarget: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  mockInitializeWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockNotifyWorkspaceFilesChanged: vi.fn(),
  mockProcessWorkspaceFileStorageCleanupNow: vi.fn(),
  mockProcessWorkspaceFileLiveDocReconciliationNow: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockResolveFolderPathFromIndex: vi.fn(),
  mockResolveWorkspaceFileFolderTarget: vi.fn(),
  mockReplaceWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE: { status: 'exact', entries: [] },
  initializeWorkspaceFileSecretProvenanceInTx: mockInitializeWorkspaceFileSecretProvenanceInTx,
  preserveWorkspaceFileSecretProvenanceInTx: vi.fn(),
  replaceWorkspaceFileSecretProvenanceInTx: mockReplaceWorkspaceFileSecretProvenanceInTx,
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceFilesChanged: mockNotifyWorkspaceFilesChanged,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox', () => ({
  enqueueWorkspaceFileLiveDocReconciliation: mockEnqueueWorkspaceFileLiveDocReconciliation,
  processWorkspaceFileLiveDocReconciliationNow: mockProcessWorkspaceFileLiveDocReconciliationNow,
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

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  enqueueWorkspaceFileStorageCleanup: mockEnqueueWorkspaceFileStorageCleanup,
  processWorkspaceFileStorageCleanupNow: mockProcessWorkspaceFileStorageCleanupNow,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: mockAssertWorkspaceFileFolderTarget,
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
  resolveWorkspaceFileFolderTarget: mockResolveWorkspaceFileFolderTarget,
}))

vi.mock('@/lib/folders/locks', () => ({
  acquireFolderMutationLock: mockAcquireFolderMutationLock,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
  resolveFolderPathFromIndex: mockResolveFolderPathFromIndex,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import {
  ContentVersionConflictError,
  deleteWorkspaceFile,
  purgeCreatedWorkspaceFile,
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
  sizeBytes: 5,
  deletedAt: null,
  uploadedAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  contentUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
  secretProvenanceVersion: 1,
}

describe('workspace file metadata and storage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockResolveWorkspaceFileFolderTarget.mockResolvedValue(null)
    mockAssertWorkspaceFileFolderTarget.mockResolvedValue(null)
    mockHasCloudStorage.mockReturnValue(false)
    mockHeadObject.mockResolvedValue({ size: FILE_ROW.size })
    mockUploadFile.mockResolvedValue({ key: FILE_ROW.key })
    mockGetWorkspaceWithOwner.mockResolvedValue({ archivedAt: null })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(10)
    mockInitializeWorkspaceFileSecretProvenanceInTx.mockResolvedValue(undefined)
    mockDecrementStorageUsageForBillingContextInTx.mockResolvedValue(undefined)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    mockEnqueueWorkspaceFileStorageCleanup.mockResolvedValue('cleanup-event-1')
    mockEnqueueWorkspaceFileLiveDocReconciliation.mockResolvedValue('live-doc-event-1')
    mockNotifyWorkspaceFilesChanged.mockResolvedValue(undefined)
    mockProcessWorkspaceFileStorageCleanupNow.mockResolvedValue('completed')
    mockProcessWorkspaceFileLiveDocReconciliationNow.mockResolvedValue('completed')
    mockReplaceWorkspaceFileSecretProvenanceInTx.mockResolvedValue(undefined)
  })

  it('returns the canonical inserted record with the pre-resolved folder path', async () => {
    const folderId = 'folder-1'
    const folderPath = 'Docs/Notes'
    const inserted = { ...FILE_ROW, folderId }
    mockResolveWorkspaceFileFolderTarget.mockResolvedValueOnce({ id: folderId, path: folderPath })
    dbChainMockFns.returning.mockResolvedValueOnce([inserted])

    const uploaded = await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType,
      { folderId }
    )

    const serveUrl = `/api/files/serve/s3/${encodeURIComponent(FILE_ROW.key)}?context=workspace`
    expect(uploaded).toEqual(
      expect.objectContaining({
        id: FILE_ROW.id,
        workspaceId: FILE_ROW.workspaceId,
        name: FILE_ROW.originalName,
        key: FILE_ROW.key,
        path: serveUrl,
        url: serveUrl,
        size: FILE_ROW.size,
        type: FILE_ROW.contentType,
        uploadedBy: FILE_ROW.userId,
        folderId,
        folderPath,
        deletedAt: null,
        uploadedAt: FILE_ROW.uploadedAt,
        updatedAt: FILE_ROW.updatedAt,
        contentUpdatedAt: FILE_ROW.contentUpdatedAt,
        context: 'workspace',
      })
    )
    expect(mockResolveWorkspaceFileFolderTarget).toHaveBeenCalledOnce()
  })

  it('re-resolves a canonical folder path under the tree lock before inserting metadata', async () => {
    const initialIndex = { version: 'initial' }
    const lockedIndex = { version: 'locked' }
    const inserted = { ...FILE_ROW, folderId: 'folder-final' }
    mockLoadActiveFolderPathIndex
      .mockResolvedValueOnce(initialIndex)
      .mockResolvedValueOnce(lockedIndex)
    mockResolveFolderPathFromIndex
      .mockReturnValueOnce('folder-initial')
      .mockReturnValueOnce('folder-final')
    dbChainMockFns.returning.mockResolvedValueOnce([inserted])

    await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType,
      { folderPath: '/Reports', exactName: true }
    )

    expect(mockAcquireFolderMutationLock).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.workspaceId,
      'file'
    )
    expect(mockLoadActiveFolderPathIndex).toHaveBeenNthCalledWith(
      2,
      FILE_ROW.workspaceId,
      'file',
      expect.any(Object)
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-final' })
    )
    expect(mockAcquireFolderMutationLock.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.values.mock.invocationCallOrder[0]
    )
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

  it('atomically purges exact archive-created metadata and accounting before storage cleanup', async () => {
    const extractedRow = { ...FILE_ROW, folderId: 'folder-archive' }
    dbChainMockFns.limit.mockResolvedValueOnce([extractedRow])
    dbChainMockFns.returning.mockResolvedValueOnce([extractedRow])

    await expect(
      purgeCreatedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        fileId: FILE_ROW.id,
        key: FILE_ROW.key,
        expectedName: FILE_ROW.originalName,
        expectedFolderId: extractedRow.folderId,
        expectedUpdatedAt: FILE_ROW.updatedAt,
      })
    ).resolves.toBe(true)

    expect(eq).toHaveBeenCalledWith(workspaceFiles.originalName, FILE_ROW.originalName)
    expect(eq).toHaveBeenCalledWith(workspaceFiles.folderId, extractedRow.folderId)
    expect(eq).toHaveBeenCalledWith(workspaceFiles.updatedAt, FILE_ROW.updatedAt)
    expect(mockDecrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.any(Object),
      STORAGE_CONTEXT,
      FILE_ROW.size
    )
    expect(mockEnqueueWorkspaceFileStorageCleanup).toHaveBeenCalledWith(expect.any(Object), {
      key: FILE_ROW.key,
    })
    expect(dbChainMockFns.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mockDecrementStorageUsageForBillingContextInTx.mock.invocationCallOrder[0]
    )
    expect(mockDecrementStorageUsageForBillingContextInTx.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueWorkspaceFileStorageCleanup.mock.invocationCallOrder[0]
    )
    expect(mockProcessWorkspaceFileStorageCleanupNow).toHaveBeenCalledWith('cleanup-event-1')
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('leaves an extracted file untouched when its creation identity no longer matches', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      purgeCreatedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        fileId: FILE_ROW.id,
        key: FILE_ROW.key,
        expectedName: FILE_ROW.originalName,
        expectedFolderId: 'folder-archive',
        expectedUpdatedAt: FILE_ROW.updatedAt,
      })
    ).resolves.toBe(false)

    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockEnqueueWorkspaceFileStorageCleanup).not.toHaveBeenCalled()
    expect(mockProcessWorkspaceFileStorageCleanupNow).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('does not touch storage when the metadata and accounting transaction fails', async () => {
    const extractedRow = { ...FILE_ROW, folderId: 'folder-archive' }
    dbChainMockFns.limit.mockResolvedValueOnce([extractedRow])
    dbChainMockFns.returning.mockResolvedValueOnce([extractedRow])
    mockDecrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('accounting unavailable')
    )

    await expect(
      purgeCreatedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        fileId: FILE_ROW.id,
        key: FILE_ROW.key,
        expectedName: FILE_ROW.originalName,
        expectedFolderId: extractedRow.folderId,
        expectedUpdatedAt: FILE_ROW.updatedAt,
      })
    ).rejects.toThrow('accounting unavailable')

    expect(mockEnqueueWorkspaceFileStorageCleanup).not.toHaveBeenCalled()
    expect(mockProcessWorkspaceFileStorageCleanupNow).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('keeps deferred cleanup durable when immediate processing fails', async () => {
    const extractedRow = { ...FILE_ROW, folderId: 'folder-archive' }
    dbChainMockFns.limit.mockResolvedValueOnce([extractedRow])
    dbChainMockFns.returning.mockResolvedValueOnce([extractedRow])
    mockProcessWorkspaceFileStorageCleanupNow.mockRejectedValueOnce(
      new Error('outbox processor unavailable')
    )

    await expect(
      purgeCreatedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        fileId: FILE_ROW.id,
        key: FILE_ROW.key,
        expectedName: FILE_ROW.originalName,
        expectedFolderId: extractedRow.folderId,
        expectedUpdatedAt: FILE_ROW.updatedAt,
      })
    ).resolves.toBe(true)

    expect(mockEnqueueWorkspaceFileStorageCleanup).toHaveBeenCalledOnce()
    expect(mockProcessWorkspaceFileStorageCleanupNow).toHaveBeenCalledWith('cleanup-event-1')
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('preserves the driver cause so the SQLSTATE survives the upload wrapper', async () => {
    const driver = Object.assign(
      new Error('cannot execute SELECT FOR UPDATE in a read-only transaction'),
      { code: '25006' }
    )
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error(
        'Failed query: select "storage_used_bytes" from "workspace" where id = $1 limit $2 for update\nparams: ws-1,1',
        { cause: driver }
      )
    )

    const thrown = await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType
    ).catch((error: unknown) => error)

    const described = describeError(thrown)
    expect(described.code).toBe('25006')
    expect(described.message).toBe('cannot execute SELECT FOR UPDATE in a read-only transaction')
  })

  it('keeps an ordinary workspace upload on the legacy untracked path', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])

    await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType
    )

    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
  })

  it('allows extraction to batch the workspace notification', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])

    await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType,
      { notifyWorkspaceChange: false }
    )

    expect(mockNotifyWorkspaceFilesChanged).not.toHaveBeenCalled()
  })

  it('persists explicitly supplied workspace upload provenance', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([FILE_ROW])

    await uploadWorkspaceFile(
      FILE_ROW.workspaceId,
      FILE_ROW.userId,
      Buffer.from('hello'),
      FILE_ROW.originalName,
      FILE_ROW.contentType,
      { secretProvenance: { status: 'exact', entries: [] } }
    )

    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.id,
      FILE_ROW.contentUpdatedAt,
      { status: 'exact', entries: [] }
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
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledTimes(1)
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.id,
      FILE_ROW.contentUpdatedAt,
      { status: 'exact', entries: [] }
    )
    expect(mockInitializeWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledTimes(1)
    expect(mockInitializeWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.id,
      FILE_ROW.contentUpdatedAt,
      { status: 'exact', entries: [] }
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('repairs a tracked direct upload missing its sidecar without charging storage again', async () => {
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW])

    const result = await registerUploadedWorkspaceFile({
      workspaceId: FILE_ROW.workspaceId,
      userId: FILE_ROW.userId,
      key: FILE_ROW.key,
      originalName: FILE_ROW.originalName,
      contentType: FILE_ROW.contentType,
    })

    expect(result.created).toBe(false)
    expect(mockInitializeWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.id,
      FILE_ROW.contentUpdatedAt,
      { status: 'exact', entries: [] }
    )
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })

  it('preserves marker-null legacy registration behavior without creating a sidecar', async () => {
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...FILE_ROW, secretProvenanceVersion: null }])

    const result = await registerUploadedWorkspaceFile({
      workspaceId: FILE_ROW.workspaceId,
      userId: FILE_ROW.userId,
      key: FILE_ROW.key,
      originalName: FILE_ROW.originalName,
      contentType: FILE_ROW.contentType,
    })

    expect(result.created).toBe(false)
    expect(mockInitializeWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
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

  it('does not delete an upload-session object when atomic finalization rolls back', async () => {
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

  it('rejects archived upload metadata without charging storage again', async () => {
    const archivedFile = {
      ...FILE_ROW,
      deletedAt: new Date('2026-07-02T00:00:00.000Z'),
    }
    mockHasCloudStorage.mockReturnValue(true)
    dbChainMockFns.limit.mockResolvedValueOnce([archivedFile])

    await expect(
      registerUploadedWorkspaceFile({
        workspaceId: FILE_ROW.workspaceId,
        userId: FILE_ROW.userId,
        key: FILE_ROW.key,
        originalName: FILE_ROW.originalName,
        contentType: FILE_ROW.contentType,
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
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
    const concurrentFile = { ...FILE_ROW, size: 7, sizeBytes: 7 }
    const replacementKey = `${FILE_ROW.key}-replacement`
    const updatedFile = {
      ...concurrentFile,
      key: replacementKey,
      size: 10,
      sizeBytes: 10,
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
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).toHaveBeenCalledWith(
      expect.any(Object),
      FILE_ROW.id,
      updatedFile.contentUpdatedAt,
      { status: 'unknown' }
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
    const updatedFile = { ...FILE_ROW, key: replacementKey, size: 10, sizeBytes: 10 }
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

  const MD_ROW = { ...FILE_ROW, originalName: 'note.md', contentType: 'text/markdown' }

  it('transactionally enqueues a markdown overwrite for live-document reconciliation', async () => {
    // Distinct updatedAt vs contentUpdatedAt so the assertion proves the merge carries the CONTENT
    // version (the persist If-Match token), not `updatedAt` — reverting that wiring would fail here.
    const updatedFile = {
      ...MD_ROW,
      size: 12,
      sizeBytes: 12,
      updatedAt: new Date('2026-07-05T00:00:00.000Z'),
      contentUpdatedAt: new Date('2026-07-04T00:00:00.000Z'),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([MD_ROW]).mockResolvedValueOnce([MD_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: MD_ROW.key })

    await updateWorkspaceFileContent(
      MD_ROW.workspaceId,
      MD_ROW.id,
      MD_ROW.userId,
      Buffer.from('# new content', 'utf-8')
    )

    expect(mockEnqueueWorkspaceFileLiveDocReconciliation).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: MD_ROW.workspaceId,
      fileId: MD_ROW.id,
      version: updatedFile.contentUpdatedAt.getTime(),
    })
    expect(mockProcessWorkspaceFileLiveDocReconciliationNow).toHaveBeenCalledWith(
      'live-doc-event-1'
    )
  })

  it('does NOT merge when syncLiveDoc is false (the relay persist / empty-shell opt-out)', async () => {
    const updatedFile = { ...MD_ROW, size: 12, sizeBytes: 12 }
    dbChainMockFns.limit.mockResolvedValueOnce([MD_ROW]).mockResolvedValueOnce([MD_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: MD_ROW.key })

    await updateWorkspaceFileContent(
      MD_ROW.workspaceId,
      MD_ROW.id,
      MD_ROW.userId,
      Buffer.from('# new content', 'utf-8'),
      undefined,
      { syncLiveDoc: false }
    )

    expect(mockEnqueueWorkspaceFileLiveDocReconciliation).not.toHaveBeenCalled()
  })

  it('does NOT merge a non-markdown write (the collaborative editor only renders markdown)', async () => {
    const updatedFile = { ...FILE_ROW, size: 10, sizeBytes: 10 }
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([FILE_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: FILE_ROW.key })

    await updateWorkspaceFileContent(
      FILE_ROW.workspaceId,
      FILE_ROW.id,
      FILE_ROW.userId,
      Buffer.alloc(10),
      'application/octet-stream'
    )

    expect(mockEnqueueWorkspaceFileLiveDocReconciliation).not.toHaveBeenCalled()
  })

  it('enqueues an oversized markdown write so an older live generation is invalidated', async () => {
    const size = PASTE_LIMITS.RICH_MARKDOWN_BYTES + 1
    const updatedFile = { ...MD_ROW, size, sizeBytes: size }
    dbChainMockFns.limit.mockResolvedValueOnce([MD_ROW]).mockResolvedValueOnce([MD_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: MD_ROW.key })

    await updateWorkspaceFileContent(
      MD_ROW.workspaceId,
      MD_ROW.id,
      MD_ROW.userId,
      Buffer.alloc(size)
    )

    expect(mockEnqueueWorkspaceFileLiveDocReconciliation).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: MD_ROW.workspaceId,
      fileId: MD_ROW.id,
      version: updatedFile.contentUpdatedAt.getTime(),
    })
  })

  it('enqueues a markdown-to-binary replacement so an older live generation is invalidated', async () => {
    const markdownByType = { ...MD_ROW, originalName: 'note.txt' }
    const updatedFile = {
      ...markdownByType,
      contentType: 'application/octet-stream',
      size: 12,
      sizeBytes: 12,
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce([markdownByType])
      .mockResolvedValueOnce([markdownByType])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: markdownByType.key })

    await updateWorkspaceFileContent(
      markdownByType.workspaceId,
      markdownByType.id,
      markdownByType.userId,
      Buffer.alloc(12),
      'application/octet-stream'
    )

    expect(mockEnqueueWorkspaceFileLiveDocReconciliation).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: markdownByType.workspaceId,
      fileId: markdownByType.id,
      version: updatedFile.contentUpdatedAt.getTime(),
    })
  })

  it('writes when the expectedUpdatedAt optimistic-concurrency guard matches', async () => {
    const updatedFile = { ...FILE_ROW, size: 12, sizeBytes: 12 }
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([FILE_ROW])
    dbChainMockFns.returning.mockResolvedValueOnce([updatedFile])
    mockUploadFile.mockResolvedValueOnce({ key: FILE_ROW.key })

    const updated = await updateWorkspaceFileContent(
      FILE_ROW.workspaceId,
      FILE_ROW.id,
      FILE_ROW.userId,
      Buffer.alloc(12),
      undefined,
      { expectedUpdatedAt: FILE_ROW.updatedAt }
    )

    expect(updated.size).toBe(12)
    expect(dbChainMockFns.returning).toHaveBeenCalled()
  })

  it('throws ContentVersionConflictError and does not write when the guard mismatches', async () => {
    // The locked row's updatedAt differs from the caller's expected value → out-of-band edit.
    dbChainMockFns.limit.mockResolvedValueOnce([FILE_ROW]).mockResolvedValueOnce([FILE_ROW])
    mockUploadFile.mockResolvedValueOnce({ key: FILE_ROW.key })

    await expect(
      updateWorkspaceFileContent(
        FILE_ROW.workspaceId,
        FILE_ROW.id,
        FILE_ROW.userId,
        Buffer.alloc(12),
        undefined,
        { expectedUpdatedAt: new Date('2020-01-01T00:00:00.000Z') }
      )
    ).rejects.toBeInstanceOf(ContentVersionConflictError)

    // Never advanced the row, and cleaned up the orphan upload it staged before the conflict.
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledWith({ key: FILE_ROW.key, context: 'workspace' })
  })
})
