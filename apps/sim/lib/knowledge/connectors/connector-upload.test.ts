/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), enqueue: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: { uploadFile: mocks.upload } }))
vi.mock('@/lib/uploads/server/metadata', () => ({ insertImmutableFileMetadata: mocks.insert }))
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  KNOWLEDGE_STORAGE_CLEANUP_EVENT: 'knowledge.document.storage.cleanup',
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
  enqueueKnowledgeStorageCleanup: mocks.enqueue,
}))

import { uploadConnectorArtifact } from '@/lib/knowledge/connectors/connector-upload'

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

describe('connector upload reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.insert.mockImplementation(async (options: { id: string }) => ({
      id: options.id,
      contentUpdatedAt: new Date(0),
    }))
    mocks.enqueue.mockResolvedValue(['cleanup-guard'])
    mocks.upload.mockResolvedValue({ key: input.key, path: `/api/files/serve/${input.key}` })
  })
  afterEach(() => vi.useRealTimers())

  it('commits the ownership binding and cleanup before writing create-only bytes', async () => {
    const uploaded = await uploadConnectorArtifact(input)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueue.mock.invocationCallOrder[0]
    )
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upload.mock.invocationCallOrder[0]
    )
    const options = mocks.upload.mock.calls[0][0]
    expect(options).toMatchObject({
      persistMetadata: false,
      createOnlyUploadId: expect.any(String),
    })
    expect(mocks.enqueue.mock.calls[0][3]).toMatchObject({ uploadId: options.createOnlyUploadId })
    expect(uploaded.metadataId).toBe(mocks.insert.mock.calls[0][0].id)
    expect(uploaded.cleanupEventId).toBe('cleanup-guard')
  })

  it('does not write bytes if durable cleanup cannot be enqueued', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('Synthetic queue persistence failure'))
    await expect(uploadConnectorArtifact(input)).rejects.toThrow('queue persistence failure')
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('does not reuse an existing metadata identity', async () => {
    mocks.insert.mockResolvedValueOnce({ id: 'previous-file', contentUpdatedAt: new Date(0) })
    await expect(uploadConnectorArtifact(input)).rejects.toThrow('already bound')
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('cancels the object write before the orphan grace period ends', async () => {
    vi.useFakeTimers()
    mocks.upload.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    )
    const pending = uploadConnectorArtifact(input)
    const rejection = expect(pending).rejects.toThrow('storage upload timed out')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejection
    expect(mocks.enqueue.mock.calls[0][3].availableAt.getTime()).toBeGreaterThan(Date.now())
    expect(vi.getTimerCount()).toBe(0)
  })
})
