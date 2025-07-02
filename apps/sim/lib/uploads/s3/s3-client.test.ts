/**
 * Tests for S3 client functionality
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('S3 Client', () => {
  const mockSend = vi.fn()
  const mockS3Client = {
    send: mockSend,
  }

  const mockPutObjectCommand = vi.fn()
  const mockGetObjectCommand = vi.fn()
  const mockDeleteObjectCommand = vi.fn()
  const mockGetSignedUrl = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => mockS3Client),
      PutObjectCommand: mockPutObjectCommand,
      GetObjectCommand: mockGetObjectCommand,
      DeleteObjectCommand: mockDeleteObjectCommand,
    }))

    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: mockGetSignedUrl,
    }))

    vi.doMock('../setup', () => ({
      S3_CONFIG: {
        bucket: 'test-bucket',
        region: 'test-region',
      },
    }))

    vi.spyOn(Date, 'now').mockReturnValue(1672603200000)
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-06-16T01:13:10.765Z')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('uploadToS3', () => {
    it('should upload a file to S3 and return file info', async () => {
      mockSend.mockResolvedValueOnce({})

      const { uploadToS3 } = await import('./s3-client')

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
        path: expect.stringContaining('/api/files/serve/s3/'),
        key: expect.stringContaining('test-file.txt'),
        name: 'test-file.txt',
        size: file.length,
        type: 'text/plain',
      })
    })

    it('should handle spaces in filenames', async () => {
      mockSend.mockResolvedValueOnce({})

      const { uploadToS3 } = await import('./s3-client')

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

      const { uploadToS3 } = await import('./s3-client')

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

      const { uploadToS3 } = await import('./s3-client')

      const testFile = Buffer.from('test file content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'

      await expect(uploadToS3(testFile, fileName, contentType)).rejects.toThrow('Upload failed')
    })
  })

  describe('getPresignedUrl', () => {
    it('should generate a presigned URL for a file', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://example.com/presigned-url')

      const { getPresignedUrl } = await import('./s3-client')

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

      const { getPresignedUrl } = await import('./s3-client')

      const key = 'test-file.txt'

      await getPresignedUrl(key)

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(Object),
        { expiresIn: 3600 } // Default is 3600 seconds (1 hour)
      )
    })

    it('should handle errors when generating presigned URL', async () => {
      const error = new Error('Presigned URL generation failed')
      mockGetSignedUrl.mockRejectedValueOnce(error)

      const { getPresignedUrl } = await import('./s3-client')

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

      const { downloadFromS3 } = await import('./s3-client')

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

      const { downloadFromS3 } = await import('./s3-client')

      const key = 'test-file.txt'

      await expect(downloadFromS3(key)).rejects.toThrow('Stream error')
    })

    it('should handle S3 client errors', async () => {
      const error = new Error('Download failed')
      mockSend.mockRejectedValueOnce(error)

      const { downloadFromS3 } = await import('./s3-client')

      const key = 'test-file.txt'

      await expect(downloadFromS3(key)).rejects.toThrow('Download failed')
    })
  })

  describe('deleteFromS3', () => {
    it('should delete a file from S3', async () => {
      mockSend.mockResolvedValueOnce({})

      const { deleteFromS3 } = await import('./s3-client')

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

      const { deleteFromS3 } = await import('./s3-client')

      const key = 'test-file.txt'

      await expect(deleteFromS3(key)).rejects.toThrow('Delete failed')
    })
  })

  describe('s3Client initialization', () => {
    it('should initialize with correct configuration', async () => {
      const { getS3Client } = await import('./s3-client')
      const { S3Client } = await import('@aws-sdk/client-s3')

      const client = getS3Client()

      expect(client).toBeDefined()
      // Verify the client was constructed with the right configuration
      expect(S3Client).toHaveBeenCalledWith({ region: 'test-region' })
    })
  })
})
