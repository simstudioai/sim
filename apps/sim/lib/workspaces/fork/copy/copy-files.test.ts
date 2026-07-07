/**
 * @vitest-environment node
 */
import { storageServiceMock, storageServiceMockFns } from '@sim/testing'
import { omit } from '@sim/utils/object'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIncrementStorageUsage } = vi.hoisted(() => ({
  mockIncrementStorageUsage: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/billing/storage', () => ({
  incrementStorageUsage: mockIncrementStorageUsage,
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
} from '@/lib/workspaces/fork/copy/copy-files'

function makeTask(overrides: Partial<BlobCopyTask> = {}): BlobCopyTask {
  return {
    sourceKey: 'workspace/src-ws/source-a.txt',
    targetKey: 'workspace/child-ws/target-a.txt',
    context: 'workspace',
    fileName: 'a.txt',
    contentType: 'text/plain',
    size: 100,
    userId: 'user-1',
    workspaceId: 'child-ws',
    ...overrides,
  }
}

describe('executeForkFileBlobCopies storage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageServiceMockFns.mockHeadObject.mockResolvedValue(null)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({ key: 'workspace/child-ws/target' })
    mockIncrementStorageUsage.mockResolvedValue(undefined)
  })

  it('charges the initiating user exactly once per landed blob, by the metadata row size', async () => {
    const tasks = [
      makeTask({ targetKey: 'workspace/child-ws/t1', size: 100 }),
      makeTask({ targetKey: 'workspace/child-ws/t2', size: 200, fileName: 'b.txt' }),
    ]

    const result = await executeForkFileBlobCopies(tasks, 'test')

    expect(result).toEqual({ copied: 2, failed: 0, failedTargetKeys: [] })
    expect(mockIncrementStorageUsage).toHaveBeenCalledTimes(2)
    expect(mockIncrementStorageUsage).toHaveBeenNthCalledWith(1, 'user-1', 100, 'child-ws')
    expect(mockIncrementStorageUsage).toHaveBeenNthCalledWith(2, 'user-1', 200, 'child-ws')
  })

  it('skips an already-existing target blob without re-copying or re-charging (replayed run)', async () => {
    storageServiceMockFns.mockHeadObject.mockResolvedValue({ size: 100 })

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsage).not.toHaveBeenCalled()
  })

  it('never charges a failed copy (the blob did not land)', async () => {
    storageServiceMockFns.mockDownloadFile.mockRejectedValue(new Error('source gone'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['workspace/child-ws/target-a.txt'],
    })
    expect(mockIncrementStorageUsage).not.toHaveBeenCalled()
  })

  it('treats a tracking failure as best-effort - the copy still counts as landed', async () => {
    mockIncrementStorageUsage.mockRejectedValue(new Error('billing hiccup'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
  })

  it('skips the charge for a legacy payload enqueued before size existed', async () => {
    // Simulates a Trigger.dev payload serialized by a pre-`size` deploy (rolling upgrade).
    const legacyTask = omit(makeTask(), ['size']) as BlobCopyTask

    const result = await executeForkFileBlobCopies([legacyTask], 'test')

    expect(result.copied).toBe(1)
    expect(mockIncrementStorageUsage).not.toHaveBeenCalled()
  })
})

describe('planForkFileCopies', () => {
  it('carries the source metadata size onto each blob task and the child row', async () => {
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
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([sourceMeta]) }) })),
      insert: vi.fn(() => ({
        values: (row: Record<string, unknown>) => {
          inserted.push(row)
          return Promise.resolve()
        },
      })),
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
      userId: 'user-1',
      workspaceId: 'child-ws',
    })
    expect(inserted[0]).toMatchObject({ size: 4321, workspaceId: 'child-ws' })
  })
})
