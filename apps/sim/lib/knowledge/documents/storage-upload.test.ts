import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }))
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  KNOWLEDGE_STORAGE_CLEANUP_EVENT: 'knowledge.document.storage.cleanup',
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
  enqueueKnowledgeStorageCleanup: mocks.enqueue,
}))

import { uploadKnowledgeArtifact } from '@/lib/knowledge/documents/storage-upload'

const input = {
  documentId: 'document-1',
  key: 'kb/synthetic-unique.txt',
  owner: { workspaceId: 'workspace-1', userId: 'user-1' },
  artifact: {
    bytes: Buffer.from('Synthetic content'),
    fileName: 'source.txt',
    mimeType: 'text/plain',
  },
}

describe('knowledge upload reservation', () => {
  beforeEach(() => {
    resetDbChainMock()
    uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mockImplementation(
      async (options: { id: string }) => ({
        id: options.id,
        contentUpdatedAt: new Date(0),
      })
    )
    mocks.enqueue.mockResolvedValue(['cleanup-guard'])
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      key: input.key,
      path: `/api/files/serve/${input.key}`,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('commits the ownership binding and cleanup before writing create-only bytes', async () => {
    const uploaded = await uploadKnowledgeArtifact(input)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(
      uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0])
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]
    )
    const options = storageServiceMockFns.mockUploadFile.mock.calls[0][0]
    expect(options).toMatchObject({
      persistMetadata: false,
      createOnlyUploadId: expect.any(String),
    })
    expect(mocks.enqueue.mock.calls[0][3]).toMatchObject({ uploadId: options.createOnlyUploadId })
    expect(uploaded.metadataId).toBe(
      uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mock.calls[0][0].id
    )
    expect(uploaded.cleanupEventId).toBe('cleanup-guard')
  })

  it('does not write bytes if durable cleanup cannot be enqueued', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('Synthetic queue persistence failure'))
    await expect(uploadKnowledgeArtifact(input)).rejects.toThrow('queue persistence failure')
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })

  it('does not reuse an existing metadata identity', async () => {
    uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mockResolvedValueOnce({
      id: 'previous-file',
      contentUpdatedAt: new Date(0),
    })
    await expect(uploadKnowledgeArtifact(input)).rejects.toThrow('already bound')
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })

  it('cancels the object write before the orphan grace period ends', async () => {
    vi.useFakeTimers()
    storageServiceMockFns.mockUploadFile.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    )
    const pending = uploadKnowledgeArtifact(input)
    const rejection = expect(pending).rejects.toThrow('storage upload timed out')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejection
    expect(mocks.enqueue.mock.calls[0][3].availableAt.getTime()).toBeGreaterThan(Date.now())
    expect(vi.getTimerCount()).toBe(0)
  })
})
