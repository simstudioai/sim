/**
 * Tests for S3 client functionality
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSend,
  mockS3Client,
  mockS3ClientConstructor,
  mockPutObjectCommand,
  mockGetObjectCommand,
  mockHeadObjectCommand,
  mockDeleteObjectCommand,
  mockListPartsCommand,
  mockCompleteMultipartUploadCommand,
  mockGetSignedUrl,
  mockEnv,
  mockS3Config,
} = vi.hoisted(() => {
  const mockSend = vi.fn()
  const mockS3Client = { send: mockSend }
  const mockEnv: Record<string, string | undefined> = {
    NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
    S3_BUCKET_NAME: 'test-bucket',
    AWS_REGION: 'test-region',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  }
  const mockS3Config: {
    bucket: string
    region: string
    endpoint: string | undefined
    forcePathStyle: boolean
  } = {
    bucket: 'test-bucket',
    region: 'test-region',
    endpoint: undefined,
    forcePathStyle: false,
  }
  return {
    mockSend,
    mockS3Client,
    mockS3Config,
    mockS3ClientConstructor: vi.fn().mockImplementation(
      class {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: vitest 4 constructs mocks via Reflect.construct; returning the object overrides the instance so `new S3Client()` yields the shared mock the tests assert on
          return mockS3Client
        }
      }
    ),
    mockPutObjectCommand: vi.fn().mockImplementation(class {}),
    mockGetObjectCommand: vi.fn().mockImplementation(class {}),
    mockHeadObjectCommand: vi.fn().mockImplementation(class {}),
    mockDeleteObjectCommand: vi.fn().mockImplementation(class {}),
    mockListPartsCommand: vi.fn().mockImplementation(class {}),
    mockCompleteMultipartUploadCommand: vi.fn().mockImplementation(class {}),
    mockGetSignedUrl: vi.fn(),
    mockEnv,
  }
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: mockS3ClientConstructor,
  PutObjectCommand: mockPutObjectCommand,
  GetObjectCommand: mockGetObjectCommand,
  HeadObjectCommand: mockHeadObjectCommand,
  DeleteObjectCommand: mockDeleteObjectCommand,
  ListPartsCommand: mockListPartsCommand,
  CompleteMultipartUploadCommand: mockCompleteMultipartUploadCommand,
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  getEnv: (key: string) => mockEnv[key],
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
  isFalsy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false,
}))

vi.mock('@/lib/uploads/config', () => ({
  S3_CONFIG: mockS3Config,
  S3_KB_CONFIG: {
    bucket: 'test-kb-bucket',
    region: 'test-region',
  },
}))

import {
  completeS3MultipartUpload,
  deleteFromS3,
  deleteS3ObjectVersion,
  downloadFromS3,
  getPresignedUrl,
  getS3Client,
  getS3PresignedUploadUrl,
  headS3Object,
  listS3MultipartParts,
  resetS3ClientForTesting,
  uploadToS3,
} from '@/lib/uploads/providers/s3/client'

describe('S3 Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1672603200000)
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-06-16T01:13:10.765Z')
    mockEnv.AWS_ACCESS_KEY_ID = 'test-access-key'
    mockEnv.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
    mockS3Config.endpoint = undefined
    mockS3Config.forcePathStyle = false
    resetS3ClientForTesting()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('uploadToS3', () => {
    it.each(['upload', 'delete'] as const)(
      'cancels a stalled %s through the SDK signal',
      async (operation) => {
        const controller = new AbortController()
        const aborted = new Error('Checkpoint expired')
        let started!: () => void
        const ready = new Promise<void>((resolve) => {
          started = resolve
        })
        mockSend.mockImplementationOnce((_command, options: { abortSignal: AbortSignal }) => {
          started()
          return new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () => reject(options.abortSignal.reason),
              { once: true }
            )
          })
        })
        const pending =
          operation === 'upload'
            ? uploadToS3(
                Buffer.from('private text'),
                'checkpoint.txt',
                'text/plain',
                undefined,
                undefined,
                true,
                undefined,
                false,
                controller.signal
              )
            : deleteFromS3('checkpoint.txt', undefined, controller.signal)
        const result = expect(pending).rejects.toBe(aborted)
        await ready
        controller.abort(aborted)
        await result
        expect(mockSend.mock.calls[0][1].abortSignal).toBe(controller.signal)
      }
    )

    it('refuses an already canceled upload before dispatching it', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(
        uploadToS3(
          Buffer.from('private text'),
          'checkpoint.txt',
          'text/plain',
          undefined,
          undefined,
          true,
          undefined,
          false,
          controller.signal
        )
      ).rejects.toHaveProperty('name', 'AbortError')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('adds a provider create-only precondition for an immutable upload', async () => {
      mockSend.mockResolvedValueOnce({})

      await uploadToS3(
        Buffer.from('new'),
        'kb/new.txt',
        'text/plain',
        undefined,
        undefined,
        true,
        { uploadId: 'attempt-1' },
        true
      )

      expect(mockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'kb/new.txt',
          IfNoneMatch: '*',
          Metadata: expect.objectContaining({ uploadId: 'attempt-1' }),
        })
      )
    })

    it('should upload a file to S3 and return file info', async () => {
      mockSend.mockResolvedValueOnce({})

      const file = Buffer.from('test content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'

      const result = await uploadToS3(file, fileName, contentType)

      expect(mockPutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: expect.stringContaining('test-file.txt'),
        Body: file,
        ContentType: 'text/plain',
        Metadata: {
          originalName: 'test-file.txt',
          uploadedAt: expect.any(String),
        },
      })

      expect(mockSend).toHaveBeenCalledWith(expect.any(Object))

      expect(result).toEqual({
        path: expect.stringContaining('/api/files/serve/'),
        key: expect.stringContaining('test-file.txt'),
        name: 'test-file.txt',
        size: file.length,
        type: 'text/plain',
      })
    })

    it('should handle spaces in filenames', async () => {
      mockSend.mockResolvedValueOnce({})

      const testFile = Buffer.from('test file content')
      const fileName = 'test file with spaces.txt'
      const contentType = 'text/plain'

      const result = await uploadToS3(testFile, fileName, contentType)

      expect(mockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.stringContaining('test-file-with-spaces.txt'),
        })
      )

      expect(result.name).toBe(fileName)
    })

    it('should use provided size if available', async () => {
      mockSend.mockResolvedValueOnce({})

      const testFile = Buffer.from('test file content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'
      const providedSize = 1000

      const result = await uploadToS3(testFile, fileName, contentType, providedSize)

      expect(result.size).toBe(providedSize)
    })

    it('should handle upload errors', async () => {
      const error = new Error('Upload failed')
      mockSend.mockRejectedValueOnce(error)

      const testFile = Buffer.from('test file content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'

      await expect(uploadToS3(testFile, fileName, contentType)).rejects.toThrow('Upload failed')
    })
  })

  describe('headS3Object', () => {
    it('returns custom metadata used for direct-upload receipt verification', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 12,
        ContentType: 'text/plain',
        Metadata: { simuploadid: 'receipt-1' },
      })

      await expect(headS3Object('workspace/file.txt')).resolves.toEqual({
        size: 12,
        contentType: 'text/plain',
        metadata: { simuploadid: 'receipt-1' },
      })
    })

    it('reports an absent object as null rather than raising', async () => {
      /**
       * A workspace file is rewritten under a new key on every content update, so a
       * reader holding the previous key lands here routinely. Absence is the answer,
       * not a failure.
       */
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('NotFound'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
      )

      await expect(headS3Object('workspace/superseded.md')).resolves.toBeNull()
    })

    it('raises when the bucket itself is missing', async () => {
      /** Also a 404, but a misconfiguration — reporting absence would hide an outage. */
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('NoSuchBucket'), {
          name: 'NoSuchBucket',
          $metadata: { httpStatusCode: 404 },
        })
      )

      await expect(headS3Object('workspace/file.txt')).rejects.toThrow('NoSuchBucket')
    })

    it('raises on a permission failure', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('AccessDenied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        })
      )

      await expect(headS3Object('workspace/file.txt')).rejects.toThrow('AccessDenied')
    })
  })

  describe('getPresignedUrl', () => {
    it('should generate a presigned URL for a file', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://example.com/presigned-url')

      const key = 'test-file.txt'
      const expiresIn = 1800

      const url = await getPresignedUrl(key, expiresIn)

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
      })

      expect(mockGetSignedUrl).toHaveBeenCalledWith(mockS3Client, expect.any(Object), { expiresIn })

      expect(url).toBe('https://example.com/presigned-url')
    })

    it('should use default expiration if not provided', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://example.com/presigned-url')

      const key = 'test-file.txt'

      await getPresignedUrl(key)

      expect(mockGetSignedUrl).toHaveBeenCalledWith(mockS3Client, expect.any(Object), {
        expiresIn: 3600,
      })
    })

    it('should handle errors when generating presigned URL', async () => {
      const error = new Error('Presigned URL generation failed')
      mockGetSignedUrl.mockRejectedValueOnce(error)

      const key = 'test-file.txt'

      await expect(getPresignedUrl(key)).rejects.toThrow('Presigned URL generation failed')
    })
  })

  describe('direct upload primitives', () => {
    it('signs metadata and a create-only condition without duplicate x-amz-meta headers', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://example.com/signed-put')

      const result = await getS3PresignedUploadUrl({
        key: 'workspace/workspace-1/file.bin',
        contentType: 'application/octet-stream',
        fileSize: 3,
        metadata: { uploadId: 'upload-1', purpose: 'workspace_file' },
        customConfig: mockS3Config,
        expiresIn: 600,
      })

      expect(mockPutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'workspace/workspace-1/file.bin',
        ContentType: 'application/octet-stream',
        ContentLength: 3,
        IfNoneMatch: '*',
        Metadata: { uploadId: 'upload-1', purpose: 'workspace_file' },
      })
      expect(result).toEqual({
        url: 'https://example.com/signed-put',
        headers: {
          'Content-Type': 'application/octet-stream',
          'If-None-Match': '*',
        },
      })
    })

    it('reads the upload identity and immutable ETag', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 3,
        ContentType: 'application/octet-stream',
        Metadata: { uploadid: 'upload-1' },
        ETag: '"etag-1"',
      })

      await expect(headS3Object('workspace/workspace-1/file.bin', mockS3Config)).resolves.toEqual({
        size: 3,
        contentType: 'application/octet-stream',
        uploadId: 'upload-1',
        version: '"etag-1"',
        metadata: { uploadid: 'upload-1' },
      })
    })

    it('lists every provider part across pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          Parts: [{ PartNumber: 1, ETag: 'etag-1', Size: 8 }],
          IsTruncated: true,
          NextPartNumberMarker: 1,
        })
        .mockResolvedValueOnce({
          Parts: [{ PartNumber: 2, ETag: 'etag-2', Size: 3 }],
          IsTruncated: false,
        })

      await expect(
        listS3MultipartParts('workspace/workspace-1/file.bin', 'provider-upload-1', mockS3Config)
      ).resolves.toEqual([
        { partNumber: 1, etag: 'etag-1', size: 8 },
        { partNumber: 2, etag: 'etag-2', size: 3 },
      ])
      expect(mockListPartsCommand).toHaveBeenLastCalledWith({
        Bucket: 'test-bucket',
        Key: 'workspace/workspace-1/file.bin',
        UploadId: 'provider-upload-1',
        PartNumberMarker: '1',
      })
    })

    it('deletes the upload object only when its ETag still matches', async () => {
      mockSend.mockResolvedValueOnce({})

      await deleteS3ObjectVersion({
        key: 'workspace/workspace-1/file.bin',
        etag: '"etag-1"',
        customConfig: mockS3Config,
      })

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'workspace/workspace-1/file.bin',
        IfMatch: '"etag-1"',
      })
    })
  })

  describe('downloadFromS3', () => {
    it('should download a file from S3', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('chunk1'))
            callback(Buffer.from('chunk2'))
          }
          if (event === 'end') {
            callback()
          }
          return mockStream
        }),
        off: vi.fn(() => mockStream),
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        $metadata: { httpStatusCode: 200 },
      })

      const key = 'test-file.txt'

      const result = await downloadFromS3(key)

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
      })

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(result).toBeInstanceOf(Buffer)
      expect(result.toString()).toBe('chunk1chunk2')
    })

    it('should handle stream errors', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Stream error'))
          }
          return mockStream
        }),
        off: vi.fn(() => mockStream),
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        $metadata: { httpStatusCode: 200 },
      })

      const key = 'test-file.txt'

      await expect(downloadFromS3(key)).rejects.toThrow('Stream error')
    })

    it('should destroy the opened stream when content length exceeds the limit', async () => {
      const mockDestroy = vi.fn()
      const mockStream = {
        destroy: mockDestroy,
        on: vi.fn(() => mockStream),
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        ContentLength: 1024,
        $metadata: { httpStatusCode: 200 },
      })

      await expect(
        downloadFromS3('large-file.txt', { bucket: 'test-bucket', region: 'test-region' }, 10)
      ).rejects.toThrow('storage download exceeds maximum size')
      expect(mockDestroy).toHaveBeenCalledWith(expect.any(Error))
    })

    it('forwards cancellation to the S3 request and stream reader', async () => {
      const controller = new AbortController()
      const mockDestroy = vi.fn()
      const mockStream = {
        destroy: mockDestroy,
        on: vi.fn(() => mockStream),
        off: vi.fn(() => mockStream),
      }
      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        $metadata: { httpStatusCode: 200 },
      })

      const download = downloadFromS3(
        'test-file.txt',
        { bucket: 'test-bucket', region: 'test-region' },
        undefined,
        controller.signal
      )
      await vi.waitFor(() => expect(mockStream.on).toHaveBeenCalled())
      controller.abort(new Error('cancelled'))

      await expect(download).rejects.toThrow('cancelled')
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ abortSignal: controller.signal })
      )
      expect(mockDestroy).toHaveBeenCalledWith()
    })

    it('should handle S3 client errors', async () => {
      const error = new Error('Download failed')
      mockSend.mockRejectedValueOnce(error)

      const key = 'test-file.txt'

      await expect(downloadFromS3(key)).rejects.toThrow('Download failed')
    })
  })

  describe('deleteFromS3', () => {
    it('should delete a file from S3', async () => {
      mockSend.mockResolvedValueOnce({})

      const key = 'test-file.txt'

      await deleteFromS3(key)

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
      })

      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('should handle delete errors', async () => {
      const error = new Error('Delete failed')
      mockSend.mockRejectedValueOnce(error)

      const key = 'test-file.txt'

      await expect(deleteFromS3(key)).rejects.toThrow('Delete failed')
    })
  })

  describe('s3Client initialization', () => {
    it('should initialize with correct configuration when credentials are available', () => {
      mockEnv.AWS_ACCESS_KEY_ID = 'test-access-key'
      mockEnv.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
      resetS3ClientForTesting()

      const client = getS3Client()

      expect(client).toBeDefined()
      expect(mockS3ClientConstructor).toHaveBeenCalledWith({
        region: 'test-region',
        endpoint: undefined,
        forcePathStyle: false,
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      })
    })

    it('should initialize without credentials when env vars are not available', () => {
      mockEnv.AWS_ACCESS_KEY_ID = undefined
      mockEnv.AWS_SECRET_ACCESS_KEY = undefined
      resetS3ClientForTesting()

      const client = getS3Client()

      expect(client).toBeDefined()
      expect(mockS3ClientConstructor).toHaveBeenCalledWith({
        region: 'test-region',
        endpoint: undefined,
        forcePathStyle: false,
        credentials: undefined,
      })
    })

    it('should pass a custom endpoint and path-style flag for S3-compatible providers', () => {
      mockS3Config.endpoint = 'https://account.r2.cloudflarestorage.com'
      mockS3Config.forcePathStyle = true
      resetS3ClientForTesting()

      const client = getS3Client()

      expect(client).toBeDefined()
      expect(mockS3ClientConstructor).toHaveBeenCalledWith({
        region: 'test-region',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      })
    })
  })

  describe('completeS3MultipartUpload fallback location', () => {
    const parts = [{ ETag: 'etag-1', PartNumber: 1 }]

    it('uses the SDK-provided Location when present', async () => {
      mockSend.mockResolvedValueOnce({ Location: 'https://provided.example.com/object' })

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(mockCompleteMultipartUploadCommand).toHaveBeenCalledWith(
        expect.objectContaining({ IfNoneMatch: '*' })
      )
      expect(result.location).toBe('https://provided.example.com/object')
      expect(result.key).toBe('kb/uuid-file.txt')
      expect(result.path).toBe('/api/files/serve/kb%2Fuuid-file.txt')
    })

    it('falls back to an AWS virtual-hosted URL when Location is absent', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(result.location).toBe(
        'https://test-kb-bucket.s3.test-region.amazonaws.com/kb/uuid-file.txt'
      )
    })

    it('returns the immutable object when a successful completion response was lost', async () => {
      mockSend
        .mockRejectedValueOnce(Object.assign(new Error('NoSuchUpload'), { name: 'NoSuchUpload' }))
        .mockResolvedValueOnce({ ContentLength: 10, ContentType: 'text/plain' })

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(mockHeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-kb-bucket',
        Key: 'kb/uuid-file.txt',
      })
      expect(result.key).toBe('kb/uuid-file.txt')
    })

    it('fails closed when a different object already occupies the key', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('PreconditionFailed'), { name: 'PreconditionFailed' })
      )

      await expect(
        completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)
      ).rejects.toThrow('PreconditionFailed')

      expect(mockHeadObjectCommand).not.toHaveBeenCalled()
    })

    it('retains replace semantics for deterministic internal exports', async () => {
      mockSend.mockResolvedValueOnce({})

      await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts, undefined, 'replace')

      expect(mockCompleteMultipartUploadCommand).toHaveBeenCalledWith(
        expect.not.objectContaining({ IfNoneMatch: '*' })
      )
    })

    it('reuses a conflicting snapshot only under the explicit policy', async () => {
      mockSend
        .mockRejectedValueOnce(
          Object.assign(new Error('PreconditionFailed'), { name: 'PreconditionFailed' })
        )
        .mockResolvedValueOnce({ ContentLength: 10, ContentType: 'text/plain' })

      const result = await completeS3MultipartUpload(
        'table-snapshots/ws-1/table.csv',
        'upload-1',
        parts,
        undefined,
        'reuse-existing'
      )

      expect(result.key).toBe('table-snapshots/ws-1/table.csv')
    })

    it('builds a path-style fallback URL for a custom endpoint with forcePathStyle', async () => {
      mockS3Config.endpoint = 'https://minio.example.com'
      mockS3Config.forcePathStyle = true
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(result.location).toBe('https://minio.example.com/test-kb-bucket/kb/uuid-file.txt')
    })

    it('builds a virtual-hosted fallback URL for a custom endpoint without forcePathStyle', async () => {
      mockS3Config.endpoint = 'https://account.r2.cloudflarestorage.com'
      mockS3Config.forcePathStyle = false
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(result.location).toBe(
        'https://test-kb-bucket.account.r2.cloudflarestorage.com/kb/uuid-file.txt'
      )
    })

    it('strips a trailing slash from the custom endpoint before appending the key', async () => {
      mockS3Config.endpoint = 'https://minio.example.com/'
      mockS3Config.forcePathStyle = true
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-file.txt', 'upload-1', parts)

      expect(result.location).toBe('https://minio.example.com/test-kb-bucket/kb/uuid-file.txt')
    })

    it('percent-encodes special characters per path segment, preserving slashes', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-my file.txt', 'upload-1', parts)

      expect(result.location).toBe(
        'https://test-kb-bucket.s3.test-region.amazonaws.com/kb/uuid-my%20file.txt'
      )
    })
  })
})
