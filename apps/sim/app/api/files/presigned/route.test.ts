import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { OPTIONS, POST } from './route'

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: vi.fn(),
  isUsingCloudStorage: vi.fn(),
}))

vi.mock('@/lib/uploads/s3/s3-client', () => ({
  getS3Client: vi.fn(),
  sanitizeFilenameForMetadata: vi.fn((filename) => filename),
}))

vi.mock('@/lib/uploads/blob/blob-client', () => ({
  getBlobServiceClient: vi.fn(),
  sanitizeFilenameForMetadata: vi.fn((filename) => filename),
}))

vi.mock('@/lib/uploads/setup', () => ({
  S3_CONFIG: {
    bucket: 'test-s3-bucket',
    region: 'us-east-1',
  },
  BLOB_CONFIG: {
    accountName: 'testaccount',
    accountKey: 'testkey',
    containerName: 'test-container',
  },
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn(),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}))

vi.mock('@azure/storage-blob', () => ({
  BlobSASPermissions: {
    parse: vi.fn(() => 'w'),
  },
  generateBlobSASQueryParameters: vi.fn(() => ({
    toString: () => 'sas-token-string',
  })),
  StorageSharedKeyCredential: vi.fn(),
}))

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}))

describe('/api/files/presigned', () => {
  let mockGetStorageProvider: any
  let mockIsUsingCloudStorage: any
  let mockGetS3Client: any
  let mockGetBlobServiceClient: any
  let mockGetSignedUrl: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    mockGetStorageProvider = vi.mocked((await import('@/lib/uploads')).getStorageProvider)
    mockIsUsingCloudStorage = vi.mocked((await import('@/lib/uploads')).isUsingCloudStorage)
    mockGetS3Client = vi.mocked((await import('@/lib/uploads/s3/s3-client')).getS3Client)
    mockGetBlobServiceClient = vi.mocked(
      (await import('@/lib/uploads/blob/blob-client')).getBlobServiceClient
    )
    mockGetSignedUrl = vi.mocked((await import('@aws-sdk/s3-request-presigner')).getSignedUrl)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('POST', () => {
    test('should return error when cloud storage is not enabled', async () => {
      mockIsUsingCloudStorage.mockReturnValue(false)

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Direct uploads are only available when cloud storage is enabled')
      expect(data.directUploadSupported).toBe(false)
    })

    test('should return error when fileName is missing', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing fileName or contentType')
    })

    test('should return error when contentType is missing', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing fileName or contentType')
    })

    test('should generate S3 presigned URL successfully', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)
      mockGetStorageProvider.mockReturnValue('s3')
      mockGetS3Client.mockReturnValue({} as any)
      mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/test-bucket/presigned-url')

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test document.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.presignedUrl).toBe('https://s3.amazonaws.com/test-bucket/presigned-url')
      expect(data.fileInfo).toMatchObject({
        path: expect.stringContaining('/api/files/serve/s3/'),
        key: expect.stringContaining('test-document.txt'),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    test('should generate Azure Blob presigned URL successfully', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)
      mockGetStorageProvider.mockReturnValue('blob')

      const mockBlockBlobClient = {
        url: 'https://testaccount.blob.core.windows.net/test-container/1704067200000-mock-uuid-1234-test-document.txt',
      }
      const mockContainerClient = {
        getBlockBlobClient: vi.fn(() => mockBlockBlobClient),
      }
      const mockBlobServiceClient = {
        getContainerClient: vi.fn(() => mockContainerClient),
      }

      mockGetBlobServiceClient.mockReturnValue(mockBlobServiceClient as any)

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test document.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.presignedUrl).toBe(
        'https://testaccount.blob.core.windows.net/test-container/1704067200000-mock-uuid-1234-test-document.txt?sas-token-string'
      )
      expect(data.fileInfo).toMatchObject({
        path: expect.stringContaining('/api/files/serve/blob/'),
        key: expect.stringContaining('test-document.txt'),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
      expect(data.uploadHeaders).toMatchObject({
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-blob-content-type': 'text/plain',
        'x-ms-meta-originalname': expect.any(String),
        'x-ms-meta-uploadedat': '2024-01-01T00:00:00.000Z',
      })

      // Verify Azure-specific calls
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('test-container')
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
        expect.stringContaining('test-document.txt')
      )
    })

    test('should return error for unknown storage provider', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)
      mockGetStorageProvider.mockReturnValue('unknown' as any)

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Unknown storage provider')
      expect(data.directUploadSupported).toBe(false)
    })

    test('should handle S3 errors gracefully', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)
      mockGetStorageProvider.mockReturnValue('s3')
      mockGetS3Client.mockReturnValue({} as any)
      mockGetSignedUrl.mockRejectedValue(new Error('S3 service unavailable'))

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Error')
      expect(data.message).toBe('S3 service unavailable')
    })

    test('should handle Azure Blob errors gracefully', async () => {
      mockIsUsingCloudStorage.mockReturnValue(true)
      mockGetStorageProvider.mockReturnValue('blob')
      mockGetBlobServiceClient.mockImplementation(() => {
        throw new Error('Azure service unavailable')
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Error')
      expect(data.message).toBe('Azure service unavailable')
    })

    test('should handle malformed JSON gracefully', async () => {
      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: 'invalid json',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('SyntaxError')
      expect(data.message).toContain('Unexpected token')
    })
  })

  describe('OPTIONS', () => {
    test('should handle CORS preflight requests', async () => {
      const response = await OPTIONS()

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, DELETE, OPTIONS'
      )
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
    })
  })
})
