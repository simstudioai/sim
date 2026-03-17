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
  mockDeleteObjectCommand,
  mockGetSignedUrl,
  mockEnv,
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
  return {
    mockSend,
    mockS3Client,
    mockS3ClientConstructor: vi.fn(() => mockS3Client),
    mockPutObjectCommand: vi.fn(),
    mockGetObjectCommand: vi.fn(),
    mockDeleteObjectCommand: vi.fn(),
    mockGetSignedUrl: vi.fn(),
    mockEnv,
  }
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: mockS3ClientConstructor,
  PutObjectCommand: mockPutObjectCommand,
  GetObjectCommand: mockGetObjectCommand,
  DeleteObjectCommand: mockDeleteObjectCommand,
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
    typeof value === 'string'
      ? value.toLowerCase() === 'false' || value === '0'
      : value === false,
}))

vi.mock('@/lib/uploads/setup', () => ({
  S3_CONFIG: {
    bucket: 'test-bucket',
    region: 'test-region',
  },
}))

vi.mock('@/lib/uploads/config', () => ({
  S3_CONFIG: {
    bucket: 'test-bucket',
    region: 'test-region',
  },
  S3_KB_CONFIG: {
    bucket: 'test-kb-bucket',
    region: 'test-region',
  },
}))

import {
  deleteFromS3,
  downloadFromS3,
  getPresignedUrl,
  getS3Client,
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
    resetS3ClientForTesting()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('uploadToS3', () => {
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
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        $metadata: { httpStatusCode: 200 },
      })

      const key = 'test-file.txt'

      await expect(downloadFromS3(key)).rejects.toThrow('Stream error')
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
        credentials: undefined,
      })
    })
  })
})
