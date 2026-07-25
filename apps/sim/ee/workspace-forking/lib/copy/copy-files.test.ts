/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  resetDbChainMock,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIncrementStorageUsageInTx, mockResolveStorageBillingContext } = vi.hoisted(() => ({
  mockIncrementStorageUsageInTx: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/billing/storage', () => ({
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageInTx,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  generateWorkspaceFileKey: vi.fn(
    (workspaceId: string, fileName: string) => `workspace/${workspaceId}/generated-${fileName}`
  ),
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  type BlobCopyTask,
  executeForkFileBlobCopies,
  planForkFileCopies,
} from '@/ee/workspace-forking/lib/copy/copy-files'

function makeTask(overrides: Partial<BlobCopyTask> = {}): BlobCopyTask {
  return {
    sourceKey: 'workspace/src-ws/source-a.txt',
    targetKey: 'workspace/child-ws/target-a.txt',
    context: 'workspace',
    fileName: 'a.txt',
    contentType: 'text/plain',
    size: 100,
    targetFileId: 'target-file-1',
    displayName: null,
    userId: 'user-1',
    workspaceId: 'child-ws',
    ...overrides,
  }
}

describe('executeForkFileBlobCopies storage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    storageServiceMockFns.mockHeadObject.mockResolvedValue(null)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({ key: 'workspace/child-ws/target' })
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'child-ws',
      billedAccountUserId: 'target-payer',
      billingEntity: { type: 'user', id: 'target-payer' },
      plan: 'pro',
      customStorageLimitGB: null,
    })
    mockIncrementStorageUsageInTx.mockResolvedValue(100)
  })

  it('copies first, then atomically inserts metadata and charges the target payer exactly once on replay', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'target-file-1' }])
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'target-file-1',
        key: 'workspace/child-ws/target-a.txt',
        workspaceId: 'child-ws',
      },
    ])

    const first = await executeForkFileBlobCopies([makeTask()], 'test')
    const replay = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(first).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(replay).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ persistMetadata: false })
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('child-ws')
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'child-ws',
        billedAccountUserId: 'target-payer',
      }),
      100
    )
    expect(storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
  })

  it('bulk-checks finalized metadata once per bounded task page', async () => {
    const tasks = Array.from({ length: 501 }, (_, index) =>
      makeTask({
        sourceKey: `workspace/src-ws/source-${index}.txt`,
        targetKey: `workspace/child-ws/target-${index}.txt`,
        targetFileId: `target-file-${index}`,
      })
    )
    const finalizedRows = tasks.map((task) => ({
      id: task.targetFileId,
      key: task.targetKey,
      workspaceId: task.workspaceId,
    }))
    dbChainMockFns.where
      .mockResolvedValueOnce(finalizedRows.slice(0, 500))
      .mockResolvedValueOnce(finalizedRows.slice(500))

    const result = await executeForkFileBlobCopies(tasks, 'test')

    expect(result).toEqual({ copied: 501, failed: 0, failedTargetKeys: [] })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('rejects bulk replay metadata whose deterministic key or workspace does not match', async () => {
    const exact = makeTask()
    const conflict = makeTask({
      targetFileId: 'target-file-2',
      targetKey: 'workspace/child-ws/target-b.txt',
    })
    dbChainMockFns.where.mockResolvedValueOnce([
      { id: exact.targetFileId, key: exact.targetKey, workspaceId: exact.workspaceId },
      { id: conflict.targetFileId, key: conflict.targetKey, workspaceId: 'other-workspace' },
    ])

    const result = await executeForkFileBlobCopies([exact, conflict], 'test')

    expect(result).toEqual({
      copied: 1,
      failed: 1,
      failedTargetKeys: [conflict.targetKey],
    })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('leaves no active metadata and never charges when the blob copy fails', async () => {
    storageServiceMockFns.mockDownloadFile.mockRejectedValue(new Error('source gone'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['workspace/child-ws/target-a.txt'],
    })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
  })

  it('rolls back metadata and cleans up the blob when authoritative accounting fails', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'target-file-1' }])
    mockIncrementStorageUsageInTx.mockRejectedValueOnce(new Error('quota changed'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['workspace/child-ws/target-a.txt'],
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/child-ws/target-a.txt',
      context: 'workspace',
    })
  })
})

describe('planForkFileCopies', () => {
  it('plans deterministic target metadata without inserting an active row before blob copy', async () => {
    const sourceMeta = {
      id: 'wf_src1',
      key: 'workspace/src-ws/1-abc-a.txt',
      userId: 'uploader-1',
      workspaceId: 'src-ws',
      folderId: 'folder-1',
      context: 'workspace',
      chatId: null,
      originalName: 'a.txt',
      displayName: null,
      contentType: 'text/plain',
      size: 4321,
      deletedAt: null,
      uploadedAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }
    const tx = {
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([sourceMeta]) }) })),
      insert: vi.fn(),
    } as unknown as DbOrTx

    const result = await planForkFileCopies({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      fileIds: ['wf_src1'],
      now: new Date('2026-02-01'),
    })

    expect(result.blobTasks).toHaveLength(1)
    expect(result.blobTasks[0]).toMatchObject({
      sourceKey: 'workspace/src-ws/1-abc-a.txt',
      targetKey: 'workspace/child-ws/generated-a.txt',
      size: 4321,
      targetFileId: expect.any(String),
      userId: 'user-1',
      workspaceId: 'child-ws',
    })
    expect(tx.insert).not.toHaveBeenCalled()
  })
})
