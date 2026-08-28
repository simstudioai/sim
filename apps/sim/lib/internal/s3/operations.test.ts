/**
 * @vitest-environment node
 */
import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  createS3Client: vi.fn(),
  destroy: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  getSignedUrl: vi.fn(),
  processSingleFileToUserFile: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/s3/client', () => ({
  createS3Client: mocks.createS3Client,
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.processSingleFileToUserFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { S3OperationError } from '@/lib/internal/s3/errors'
import {
  executeS3CopyObject,
  executeS3HeadObject,
  executeS3ListBuckets,
  executeS3PresignedUrl,
  executeS3PutObject,
} from '@/lib/internal/s3/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const CONNECTION = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'us-east-1',
}

const CONTEXT = {
  headers: new Headers(),
  requestId: 'request-1',
  userId: 'user-1',
}

describe('S3 operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createS3Client.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processSingleFileToUserFile.mockReturnValue({
      key: 'workspace/file-key',
      name: 'file.txt',
      size: 5,
      type: 'text/plain',
    })
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
  })

  it('copies encoded object keys, forwards cancellation, and destroys the client', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      CopyObjectResult: { ETag: 'etag' },
      CopySourceVersionId: 'source-version',
      VersionId: 'version',
    })

    const result = await executeS3CopyObject(
      {
        ...CONNECTION,
        sourceBucket: 'source',
        sourceKey: 'folder/source file.txt',
        destinationBucket: 'destination',
        destinationKey: 'folder/destination file.txt',
      },
      controller.signal
    )

    const [command, options] = mocks.send.mock.calls[0]
    expect(command).toBeInstanceOf(CopyObjectCommand)
    expect(command.input).toMatchObject({
      CopySource: 'source/folder/source%20file.txt',
      Key: 'folder/destination file.txt',
    })
    expect(options).toEqual({ abortSignal: controller.signal })
    expect(result.output).toMatchObject({
      url: 'https://destination.s3.us-east-1.amazonaws.com/folder/destination%20file.txt',
      uri: 's3://destination/folder/destination file.txt',
      etag: 'etag',
    })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('maps an S3 not-found head response to exists false', async () => {
    mocks.send.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })

    const result = await executeS3HeadObject({
      ...CONNECTION,
      bucketName: 'bucket',
      objectKey: 'missing.txt',
    })

    expect(mocks.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
    expect(result.output).toEqual({
      exists: false,
      contentLength: null,
      contentType: null,
      etag: null,
      lastModified: null,
      versionId: null,
      storageClass: null,
      serverSideEncryption: null,
      deleteMarker: null,
      metadata: {},
    })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('preserves list-buckets pagination and nullable fields', async () => {
    mocks.send.mockResolvedValue({
      Buckets: [{ Name: 'bucket', CreationDate: new Date('2026-01-01T00:00:00.000Z') }],
      ContinuationToken: 'next',
      Prefix: 'prod-',
    })

    const result = await executeS3ListBuckets({
      ...CONNECTION,
      prefix: 'prod-',
      maxBuckets: 25,
      continuationToken: 'token',
    })

    const command = mocks.send.mock.calls[0][0]
    expect(command).toBeInstanceOf(ListBucketsCommand)
    expect(command.input).toEqual({
      Prefix: 'prod-',
      MaxBuckets: 25,
      ContinuationToken: 'token',
    })
    expect(result.output).toEqual({
      buckets: [
        {
          name: 'bucket',
          creationDate: '2026-01-01T00:00:00.000Z',
          region: null,
        },
      ],
      owner: null,
      continuationToken: 'next',
      prefix: 'prod-',
    })
  })

  it('generates presigned URLs without leaking the client', async () => {
    mocks.getSignedUrl.mockResolvedValue('https://signed.example/object')

    const result = await executeS3PresignedUrl({
      ...CONNECTION,
      bucketName: 'bucket',
      objectKey: 'object.txt',
      method: 'put',
      expiresIn: 300,
      contentType: 'text/plain',
    })

    expect(mocks.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ send: mocks.send }),
      expect.any(PutObjectCommand),
      { expiresIn: 300 }
    )
    expect(result.output.url).toBe('https://signed.example/object')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('uploads inline content with the same public URL and content-type semantics', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({ ETag: 'etag' })

    const result = await executeS3PutObject(
      {
        ...CONNECTION,
        bucketName: 'bucket',
        objectKey: 'folder/file name.txt',
        content: 'hello',
      },
      { ...CONTEXT, signal: controller.signal }
    )

    const [command, options] = mocks.send.mock.calls[0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'folder/file name.txt',
      ContentType: 'text/plain',
    })
    expect(Buffer.from(command.input.Body).toString()).toBe('hello')
    expect(options).toEqual({ abortSignal: controller.signal })
    expect(result.output.url).toBe(
      'https://bucket.s3.us-east-1.amazonaws.com/folder/file%20name.txt'
    )
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('authorizes and bounds stored files before sending them to S3', async () => {
    mocks.send.mockResolvedValue({})
    const file = { key: 'workspace/file-key', name: 'file.txt', size: 5, type: 'text/plain' }

    await executeS3PutObject(
      { ...CONNECTION, bucketName: 'bucket', objectKey: 'file.txt', file },
      CONTEXT
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file-key',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workspace/file-key' }),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
  })

  it('fails closed when stored-file access is denied', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeS3PutObject(
        {
          ...CONNECTION,
          bucketName: 'bucket',
          objectKey: 'file.txt',
          file: { key: 'workspace/file-key', name: 'file.txt', size: 5 },
        },
        CONTEXT
      )
    ).rejects.toEqual(new S3OperationError('File not found', 404))
    expect(mocks.createS3Client).not.toHaveBeenCalled()
  })

  it('destroys the client when AWS rejects the operation', async () => {
    mocks.send.mockRejectedValue(new Error('S3 rejected'))

    await expect(executeS3ListBuckets(CONNECTION)).rejects.toThrow('S3 rejected')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
