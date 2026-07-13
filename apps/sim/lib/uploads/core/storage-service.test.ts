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
  mockInsertFileMetadata,
  partBodies,
} = vi.hoisted(() => ({
  mockInitiate: vi.fn(),
  mockUploadPart: vi.fn(),
  mockComplete: vi.fn(),
  mockAbort: vi.fn(),
  mockUploadToS3: vi.fn(),
  mockInsertFileMetadata: vi.fn(),
  partBodies: [] as Buffer[],
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: true,
  USE_BLOB_STORAGE: false,
  getStorageConfig: () => ({ bucket: 'b', region: 'r' }),
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  initiateS3MultipartUpload: mockInitiate,
  uploadS3Part: mockUploadPart,
  completeS3MultipartUpload: mockComplete,
  abortS3MultipartUpload: mockAbort,
  uploadToS3: mockUploadToS3,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  insertFileMetadata: mockInsertFileMetadata,
}))

import { createMultipartUpload, uploadFile } from '@/lib/uploads/core/storage-service'

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

  it('takes the single-shot PutObject path for a payload smaller than one part', async () => {
    const handle = await createMultipartUpload({
      key: 'k',
      context: 'execution',
      contentType: 'text/csv',
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
    expect(result.size).toBe(10 * 1024 * 1024)
    expect(mockUploadToS3).not.toHaveBeenCalled()
  })

  it('aborts the multipart upload and leaves no object', async () => {
    const handle = await createMultipartUpload({
      key: 'k',
      context: 'execution',
      contentType: 'text/csv',
    })
    await handle.write(Buffer.alloc(9 * 1024 * 1024, 7)) // crosses one part → multipart started
    await handle.abort()

    expect(mockInitiate).toHaveBeenCalledTimes(1)
    expect(mockAbort).toHaveBeenCalledTimes(1)
    expect(mockComplete).not.toHaveBeenCalled()
  })
})
