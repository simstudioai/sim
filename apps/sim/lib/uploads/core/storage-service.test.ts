/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInitiate,
  mockUploadPart,
  mockComplete,
  mockAbort,
  mockUploadToS3,
  mockDeleteFromS3,
  mockInsertFileMetadata,
  mockInsertImmutableFileMetadata,
  mockCleanupUnboundKnowledgeUpload,
  mockGetSignedUrl,
  mockHeadS3Object,
  mockPutObjectCommand,
  mockS3Client,
  partBodies,
} = vi.hoisted(() => ({
  mockInitiate: vi.fn(),
  mockUploadPart: vi.fn(),
  mockComplete: vi.fn(),
  mockAbort: vi.fn(),
  mockUploadToS3: vi.fn(),
  mockDeleteFromS3: vi.fn(),
  mockInsertFileMetadata: vi.fn(),
  mockInsertImmutableFileMetadata: vi.fn(),
  mockCleanupUnboundKnowledgeUpload: vi.fn(),
  mockGetSignedUrl: vi.fn(),
  mockHeadS3Object: vi.fn(),
  mockPutObjectCommand: vi.fn().mockImplementation(class {}),
  mockS3Client: {},
  partBodies: [] as Buffer[],
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: mockPutObjectCommand,
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: true,
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  getStorageConfig: () => ({ bucket: 'b', region: 'r' }),
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  initiateS3MultipartUpload: mockInitiate,
  uploadS3Part: mockUploadPart,
  completeS3MultipartUpload: mockComplete,
  abortS3MultipartUpload: mockAbort,
  uploadToS3: mockUploadToS3,
  deleteFromS3: mockDeleteFromS3,
  getS3Client: () => mockS3Client,
  headS3Object: mockHeadS3Object,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  insertFileMetadata: mockInsertFileMetadata,
  insertImmutableFileMetadata: mockInsertImmutableFileMetadata,
}))

vi.mock('@/lib/uploads/core/knowledge-upload-cleanup', () => ({
  cleanupUnboundKnowledgeUpload: mockCleanupUnboundKnowledgeUpload,
}))

import { createMultipartUpload, deleteFile, uploadFile } from '@/lib/uploads/core/storage-service'

const PART_SIZE = 8 * 1024 * 1024

describe('createMultipartUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    partBodies.length = 0
    mockInitiate.mockResolvedValue({ uploadId: 'up1', key: 'k' })
    mockUploadPart.mockImplementation((_key, _uploadId, partNumber: number, body: Buffer) => {
      partBodies.push(body)
      return Promise.resolve({ PartNumber: partNumber, ETag: `etag-${partNumber}` })
    })
    mockComplete.mockResolvedValue({ location: 'l', path: 'p', key: 'k' })
    mockAbort.mockResolvedValue(undefined)
    mockUploadToS3.mockResolvedValue({ key: 'k', path: 'p', name: 'k', size: 0, type: 'text/csv' })
    mockInsertFileMetadata.mockResolvedValue({ id: 'file-1' })
    mockInsertImmutableFileMetadata.mockResolvedValue({ id: 'file-1' })
    mockCleanupUnboundKnowledgeUpload.mockResolvedValue(undefined)
    mockGetSignedUrl.mockResolvedValue('https://s3.example/create-only')
    mockHeadS3Object.mockResolvedValue(null)
  })

  it('can upload an object without persisting generic metadata', async () => {
    await uploadFile({
      file: Buffer.from('hello'),
      fileName: 'k',
      contentType: 'text/plain',
      context: 'workspace',
      metadata: { userId: 'user-1', workspaceId: 'workspace-1' },
      persistMetadata: false,
    })

    expect(mockUploadToS3).toHaveBeenCalledTimes(1)
    expect(mockInsertFileMetadata).not.toHaveBeenCalled()
  })

  it('preserves a pre-reserved create-only identity without registering metadata again', async () => {
    await uploadFile({
      file: Buffer.from('reserved content'),
      fileName: 'reserved.txt',
      customKey: 'kb/reserved.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      preserveKey: true,
      metadata: { userId: 'user-1', workspaceId: 'workspace-1' },
      persistMetadata: false,
      createOnlyUploadId: 'reserved-upload-1',
    })
    expect(mockUploadToS3.mock.calls[0][6]).toMatchObject({ uploadId: 'reserved-upload-1' })
    expect(mockUploadToS3.mock.calls[0][7]).toBe(true)
    expect(mockInsertImmutableFileMetadata).not.toHaveBeenCalled()
  })

  it('forwards checkpoint cancellation to cloud uploads and deletes', async () => {
    const signal = new AbortController().signal
    await uploadFile({
      file: Buffer.from('private text'),
      fileName: 'checkpoint.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      preserveKey: true,
      persistMetadata: false,
      signal,
    })
    expect(mockUploadToS3.mock.calls[0][8]).toBe(signal)
    await deleteFile({ key: 'checkpoint.txt', context: 'knowledge-base', signal })
    expect(mockDeleteFromS3).toHaveBeenCalledWith(
      'checkpoint.txt',
      { bucket: 'b', region: 'r' },
      signal
    )
  })

  it('persists connector caches with an immutable organization binding', async () => {
    await uploadFile({
      file: Buffer.from('hello'),
      fileName: 'kb/file.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      metadata: { userId: 'user-1', organizationId: 'org-1' },
    })
    expect(mockInsertFileMetadata).not.toHaveBeenCalled()
    expect(mockInsertImmutableFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: null,
        folderId: null,
        context: 'knowledge-base',
      })
    )
    expect(mockUploadToS3.mock.calls[0][6]).toMatchObject({
      organizationId: 'org-1',
      uploadId: expect.any(String),
    })
    expect(mockUploadToS3.mock.calls[0][7]).toBe(true)
  })

  it('cleans up the exact upload attempt when cache metadata persistence fails', async () => {
    const failure = new Error('organization foreign key failed')
    mockInsertImmutableFileMetadata.mockRejectedValueOnce(failure)

    await expect(
      uploadFile({
        file: Buffer.from('hello'),
        fileName: 'kb/new.txt',
        contentType: 'text/plain',
        context: 'knowledge-base',
        metadata: { userId: 'user-1', organizationId: 'org-1', uploadId: 'caller-supplied' },
      })
    ).rejects.toBe(failure)

    const uploadId = mockUploadToS3.mock.calls[0][6].uploadId
    expect(uploadId).not.toBe('caller-supplied')
    expect(mockCleanupUnboundKnowledgeUpload).toHaveBeenCalledExactlyOnceWith('k', uploadId)
  })

  it('preserves the metadata error if compensation also fails', async () => {
    const failure = new Error('metadata unavailable')
    mockInsertImmutableFileMetadata.mockRejectedValueOnce(failure)
    mockCleanupUnboundKnowledgeUpload.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(
      uploadFile({
        file: Buffer.from('hello'),
        fileName: 'kb/new.txt',
        contentType: 'text/plain',
        context: 'knowledge-base',
        metadata: { userId: 'user-1', workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)

    expect(mockCleanupUnboundKnowledgeUpload).toHaveBeenCalledTimes(1)
  })

  it('does not compensate a failed create-only write that may belong to a prior upload', async () => {
    const conflict = new Error('object already exists')
    mockUploadToS3.mockRejectedValueOnce(conflict)

    await expect(
      uploadFile({
        file: Buffer.from('hello'),
        fileName: 'kb/existing.txt',
        contentType: 'text/plain',
        context: 'knowledge-base',
        metadata: { userId: 'user-1', organizationId: 'org-1' },
      })
    ).rejects.toBe(conflict)

    expect(mockInsertImmutableFileMetadata).not.toHaveBeenCalled()
    expect(mockCleanupUnboundKnowledgeUpload).not.toHaveBeenCalled()
  })

  it('leaves replacement uploads and caller-managed metadata outside cache compensation', async () => {
    const failure = new Error('metadata unavailable')
    mockInsertFileMetadata.mockRejectedValueOnce(failure)

    await expect(
      uploadFile({
        file: Buffer.from('hello'),
        fileName: 'workspace/existing.txt',
        contentType: 'text/plain',
        context: 'workspace',
        preserveKey: true,
        metadata: { userId: 'user-1', workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)
    expect(mockUploadToS3.mock.calls[0][7]).toBe(false)

    await uploadFile({
      file: Buffer.from('hello'),
      fileName: 'kb/admitted.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      persistMetadata: false,
      metadata: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(mockUploadToS3.mock.calls[1][7]).toBe(false)
    expect(mockInsertImmutableFileMetadata).not.toHaveBeenCalled()
    expect(mockCleanupUnboundKnowledgeUpload).not.toHaveBeenCalled()
  })

  it('takes the single-shot PutObject path for a payload smaller than one part', async () => {
    const handle = await createMultipartUpload({
      key: 'k',
      context: 'execution',
      contentType: 'text/csv',
      completionPolicy: 'replace',
    })
    await handle.write('hello')
    const result = await handle.complete()

    expect(mockInitiate).not.toHaveBeenCalled()
    expect(mockUploadPart).not.toHaveBeenCalled()
    expect(mockUploadToS3).toHaveBeenCalledTimes(1)
    expect((mockUploadToS3.mock.calls[0][0] as Buffer).toString('utf8')).toBe('hello')
    expect(result).toEqual({ key: 'k', size: 5 })
  })

  it('splits into parts and reassembles byte-for-byte over one part boundary', async () => {
    const a = Buffer.alloc(5 * 1024 * 1024, 1)
    const b = Buffer.alloc(5 * 1024 * 1024, 2)

    const handle = await createMultipartUpload({
      key: 'k',
      context: 'execution',
      contentType: 'text/csv',
      completionPolicy: 'replace',
    })
    await handle.write(a)
    await handle.write(b)
    const result = await handle.complete()

    expect(mockInitiate).toHaveBeenCalledTimes(1)
    // 10MB → one full 8MB part + a 2MB remainder on complete.
    expect(mockUploadPart).toHaveBeenCalledTimes(2)
    expect(partBodies[0].length).toBe(PART_SIZE)
    const reassembled = Buffer.concat(partBodies)
    expect(reassembled.length).toBe(10 * 1024 * 1024)
    expect(reassembled.equals(Buffer.concat([a, b]))).toBe(true)
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(mockComplete).toHaveBeenCalledWith(
      'k',
      'up1',
      expect.any(Array),
      { bucket: 'b', region: 'r' },
      'replace'
    )
    expect(result.size).toBe(10 * 1024 * 1024)
    expect(mockUploadToS3).not.toHaveBeenCalled()
  })

  it('aborts the multipart upload and leaves no object', async () => {
    const handle = await createMultipartUpload({
      key: 'k',
      context: 'execution',
      contentType: 'text/csv',
      completionPolicy: 'replace',
    })
    await handle.write(Buffer.alloc(9 * 1024 * 1024, 7)) // crosses one part → multipart started
    await handle.abort()

    expect(mockInitiate).toHaveBeenCalledTimes(1)
    expect(mockAbort).toHaveBeenCalledTimes(1)
    expect(mockComplete).not.toHaveBeenCalled()
  })
})
