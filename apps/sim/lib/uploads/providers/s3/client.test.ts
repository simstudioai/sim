/**
 * Tests for S3 client functionality
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
  getS3PresignedUploadUrl,
  headS3Object,
  listS3MultipartParts,
  resetS3ClientForTesting,
  uploadToS3,
} from '@/lib/uploads/providers/s3/client'

describe('S3 Client', () => {
  beforeEach(() => {
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
  })

  describe('headS3Object', () => {
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
  })

  describe('completeS3MultipartUpload fallback location', () => {
    const parts = [{ ETag: 'etag-1', PartNumber: 1 }]

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

    it('percent-encodes special characters per path segment, preserving slashes', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await completeS3MultipartUpload('kb/uuid-my file.txt', 'upload-1', parts)

      expect(result.location).toBe(
        'https://test-kb-bucket.s3.test-region.amazonaws.com/kb/uuid-my%20file.txt'
      )
    })
  })
})
