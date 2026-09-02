/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSecret: vi.fn(),
  assertToolFileAccess: vi.fn(),
  processSingleFile: vi.fn(),
  downloadServableFile: vi.fn(),
  attempts: vi.fn(),
}))

vi.mock('@/lib/uploads/shared/types', () => ({ MAX_BUFFERED_TRANSFER_BYTES: 5 }))
vi.mock('@/lib/credentials/oci-object-storage-service-account', () => ({
  getOciObjectStorageServiceAccountSecret: mocks.getSecret,
}))
vi.mock('@/lib/internal/oci-object-storage/client', () => ({
  withOciObjectStorageClient: async (
    _secret: unknown,
    attempts: number,
    execute: (client: { send: typeof mocks.send }) => Promise<unknown>
  ) => {
    mocks.attempts(attempts)
    return execute({ send: mocks.send })
  },
  sendOciListBuckets: (client: { send: typeof mocks.send }, signal?: AbortSignal) =>
    client.send(new ListBucketsCommand({}), { abortSignal: signal }),
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.processSingleFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFile,
}))

import {
  executeOciObjectStorageDeleteObject,
  executeOciObjectStorageDownloadObject,
  executeOciObjectStorageHeadObject,
  executeOciObjectStorageListBuckets,
  executeOciObjectStorageListObjects,
  executeOciObjectStorageUploadObject,
} from '@/lib/internal/oci-object-storage/operations'

const credential = { credentialId: 'credential-1' }
const object = { ...credential, bucketName: 'bucket-name', objectKey: 'folder/report.txt' }
const context = { userId: 'user-1', requestId: 'request-1' }

describe('OCI Object Storage operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSecret.mockResolvedValue({
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      namespace: 'namespace1',
      region: 'us-ashburn-1',
    })
    mocks.assertToolFileAccess.mockResolvedValue(null)
  })

  it('maps empty and populated bucket listings with owner identity', async () => {
    mocks.send
      .mockResolvedValueOnce({ Owner: { ID: 'owner-1', DisplayName: 'Owner' }, Buckets: [] })
      .mockResolvedValueOnce({
        Owner: { ID: 'owner-1', DisplayName: 'Owner' },
        Buckets: [
          { Name: 'bucket-name', CreationDate: new Date('2026-09-02T12:00:00Z') },
          { CreationDate: new Date('2026-09-02T12:00:00Z') },
        ],
      })

    await expect(executeOciObjectStorageListBuckets(credential)).resolves.toMatchObject({
      output: { buckets: [], owner: { id: 'owner-1', displayName: 'Owner' } },
    })
    await expect(executeOciObjectStorageListBuckets(credential)).resolves.toMatchObject({
      output: {
        buckets: [{ name: 'bucket-name', creationDate: '2026-09-02T12:00:00.000Z' }],
      },
    })
    expect(mocks.send.mock.calls[0]?.[0]).toBeInstanceOf(ListBucketsCommand)
  })

  it('forwards listing controls and preserves opaque truncated-page data', async () => {
    mocks.send.mockResolvedValue({
      Name: 'bucket-name',
      Contents: [
        {
          Key: 'folder/a b#.txt',
          Size: 7,
          LastModified: new Date('2026-09-02T12:00:00Z'),
          ETag: '"etag"',
          StorageClass: 'STANDARD',
        },
      ],
      CommonPrefixes: [{ Prefix: 'folder/sub/' }],
      KeyCount: 2,
      MaxKeys: 25,
      IsTruncated: true,
      NextContinuationToken: 'opaque-next+/=',
      ContinuationToken: 'opaque-current',
      StartAfter: 'folder/a.txt',
      Prefix: 'folder/',
      Delimiter: '/',
    })

    const result = await executeOciObjectStorageListObjects({
      ...credential,
      bucketName: 'bucket-name',
      prefix: 'folder/',
      delimiter: '/',
      maxKeys: 25,
      startAfter: 'folder/a.txt',
      continuationToken: 'opaque-current',
    })

    const command = mocks.send.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(ListObjectsV2Command)
    expect(command.input).toMatchObject({
      Bucket: 'bucket-name',
      Prefix: 'folder/',
      Delimiter: '/',
      MaxKeys: 25,
      StartAfter: 'folder/a.txt',
      ContinuationToken: 'opaque-current',
    })
    expect(result.output).toMatchObject({
      objects: [{ key: 'folder/a b#.txt', size: 7, storageClass: 'STANDARD' }],
      commonPrefixes: ['folder/sub/'],
      isTruncated: true,
      nextContinuationToken: 'opaque-next+/=',
    })
    expect(mocks.attempts).toHaveBeenCalledWith(3)
  })

  it('rejects parseable but semantically malformed object listings', async () => {
    mocks.send.mockResolvedValueOnce({
      Contents: [{ Size: 7 }],
      IsTruncated: false,
    })
    await expect(
      executeOciObjectStorageListObjects({
        ...credential,
        bucketName: 'bucket-name',
        maxKeys: 100,
      })
    ).rejects.toMatchObject({ status: 502 })

    mocks.send.mockResolvedValueOnce({ Contents: [], IsTruncated: true })
    await expect(
      executeOciObjectStorageListObjects({
        ...credential,
        bucketName: 'bucket-name',
        maxKeys: 100,
      })
    ).rejects.toMatchObject({ status: 502 })
  })

  it('authorizes a referenced file before reading and uploads exact-limit bytes', async () => {
    const file = { name: 'report.txt', key: 'workspace/file-1', size: 5, type: 'text/plain' }
    mocks.processSingleFile.mockReturnValue(file)
    mocks.downloadServableFile.mockResolvedValue({
      buffer: Buffer.from('12345'),
      contentType: 'text/plain',
    })
    mocks.send.mockResolvedValue({ ETag: '"etag"', $metadata: { requestId: 'request-1' } })

    const result = await executeOciObjectStorageUploadObject(
      { ...object, file: file as never, contentType: 'application/custom' },
      context
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file-1',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.assertToolFileAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadServableFile.mock.invocationCallOrder[0]
    )
    expect(mocks.downloadServableFile).toHaveBeenCalledWith(file, 'request-1', expect.anything(), {
      maxBytes: 5,
      signal: undefined,
    })
    const command = mocks.send.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({
      Bucket: 'bucket-name',
      Key: 'folder/report.txt',
      Body: Buffer.from('12345'),
      ContentLength: 5,
      ContentType: 'application/custom',
    })
    expect(result.output).toMatchObject({ size: 5, etag: '"etag"' })
    expect(mocks.attempts).toHaveBeenCalledWith(1)
  })

  it('rejects a file-backed upload without an actor before resolving or reading the file', async () => {
    const file = { name: 'report.txt', key: 'workspace/file-1', size: 5, type: 'text/plain' }

    await expect(
      executeOciObjectStorageUploadObject(
        { ...object, file: file as never },
        { requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 401, message: 'Authentication required' })
    expect(mocks.processSingleFile).not.toHaveBeenCalled()
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.downloadServableFile).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not send an upload when the authorized file exceeds the limit while reading', async () => {
    const file = {
      name: 'large.bin',
      key: 'workspace/file-2',
      size: 6,
      type: 'application/octet-stream',
    }
    mocks.processSingleFile.mockReturnValue(file)
    mocks.downloadServableFile.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'OCI file upload', maxBytes: 5, observedBytes: 6 })
    )

    await expect(
      executeOciObjectStorageUploadObject({ ...object, file: file as never }, context)
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(mocks.assertToolFileAccess).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('accepts empty inline content, enforces the inline limit, and uses one write attempt', async () => {
    mocks.send.mockResolvedValue({ $metadata: {} })
    await expect(
      executeOciObjectStorageUploadObject({ ...object, content: '' }, context)
    ).resolves.toMatchObject({ output: { size: 0, contentType: 'text/plain; charset=utf-8' } })
    await expect(
      executeOciObjectStorageUploadObject({ ...object, content: '123456' }, context)
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('returns documented head metadata and a canonical downloaded file', async () => {
    mocks.send
      .mockResolvedValueOnce({
        ContentLength: 5,
        ContentType: 'text/plain',
        ContentEncoding: 'identity',
        ETag: '"head-etag"',
        LastModified: new Date('2026-09-02T12:00:00Z'),
        StorageClass: 'STANDARD',
        Metadata: { source: 'test' },
        $metadata: { requestId: 'head-request' },
      })
      .mockResolvedValueOnce({
        ContentLength: 5,
        ContentType: 'text/plain',
        ETag: '"head-etag"',
        LastModified: new Date('2026-09-02T12:00:00Z'),
        Metadata: { source: 'test' },
        $metadata: { requestId: 'head-request' },
      })
      .mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('12345')]),
        ContentType: 'text/plain',
        ETag: '"get-etag"',
        Metadata: { source: 'test' },
        $metadata: { requestId: 'get-request' },
      })

    await expect(executeOciObjectStorageHeadObject(object)).resolves.toMatchObject({
      output: {
        contentLength: 5,
        contentType: 'text/plain',
        contentEncoding: 'identity',
        storageClass: 'STANDARD',
        metadata: { source: 'test' },
      },
    })
    await expect(executeOciObjectStorageDownloadObject(object)).resolves.toMatchObject({
      output: {
        file: {
          name: 'report.txt',
          mimeType: 'text/plain',
          data: Buffer.from('12345').toString('base64'),
          size: 5,
        },
        etag: '"get-etag"',
        requestId: 'get-request',
      },
    })
    expect(mocks.send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand)
    expect(mocks.send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand)
    expect(mocks.send.mock.calls[2]?.[0]).toBeInstanceOf(GetObjectCommand)
  })

  it('preflights declared download sizes and enforces the limit again while streaming', async () => {
    mocks.send.mockResolvedValueOnce({ ContentLength: 6, $metadata: {} })
    await expect(executeOciObjectStorageDownloadObject(object)).rejects.toBeInstanceOf(
      PayloadSizeLimitError
    )
    expect(mocks.send).toHaveBeenCalledTimes(1)

    mocks.send.mockReset()
    mocks.send.mockResolvedValueOnce({ ContentLength: 3, $metadata: {} }).mockResolvedValueOnce({
      Body: Readable.from([Buffer.from('123'), Buffer.from('456')]),
      $metadata: {},
    })
    await expect(executeOciObjectStorageDownloadObject(object)).rejects.toBeInstanceOf(
      PayloadSizeLimitError
    )

    mocks.send.mockReset()
    mocks.send.mockResolvedValueOnce({ $metadata: {} }).mockResolvedValueOnce({
      Body: Readable.from([Buffer.from('12345')]),
      $metadata: {},
    })
    await expect(executeOciObjectStorageDownloadObject(object)).resolves.toMatchObject({
      output: { contentLength: 5 },
    })
  })

  it('passes abort signals and returns explicit deletion success for a 204 response', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({ $metadata: { httpStatusCode: 204, requestId: 'delete-1' } })

    await expect(executeOciObjectStorageDeleteObject(object, controller.signal)).resolves.toEqual({
      success: true,
      output: {
        deleted: true,
        bucket: 'bucket-name',
        key: 'folder/report.txt',
        requestId: 'delete-1',
      },
    })
    expect(mocks.send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand)
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.attempts).toHaveBeenCalledWith(1)
  })
})
