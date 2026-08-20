import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'

describe('/api/files/presigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('POST', () => {
    test('should return error when cloud storage is not enabled', async () => {
      setupFileApiMocks({
        cloudEnabled: false,
        storageProvider: 's3',
      })

      const { POST } = await import('./route')

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

    it('should return error when fileName is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('./route')

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

    it('should return error when contentType is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('./route')

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

    it('should generate S3 presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('./route')

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
      expect(data.presignedUrl).toBe('https://example.com/presigned-url')
      expect(data.fileInfo).toMatchObject({
        path: expect.stringContaining('/api/files/serve/s3/'),
        key: expect.stringContaining('test-document.txt'),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate Azure Blob presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      const { POST } = await import('./route')

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
      expect(data.presignedUrl).toContain('https://example.com/presigned-url')
      expect(data.presignedUrl).toContain('sas-token-string')
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
    })

    it('should return error for unknown storage provider', async () => {
      // For unknown provider, we'll need to mock manually since our helper doesn't support it
      vi.doMock('@/lib/uploads', () => ({
        getStorageProvider: vi.fn().mockReturnValue('unknown'),
        isUsingCloudStorage: vi.fn().mockReturnValue(true),
      }))

      const { POST } = await import('./route')

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

    it('should handle S3 errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      // Override with error-throwing mock while preserving other exports
      vi.doMock('@/lib/uploads', () => ({
        getStorageProvider: vi.fn().mockReturnValue('s3'),
        isUsingCloudStorage: vi.fn().mockReturnValue(true),
        uploadFile: vi.fn().mockResolvedValue({
          path: '/api/files/serve/test-key',
          key: 'test-key',
          name: 'test.txt',
          size: 100,
          type: 'text/plain',
        }),
      }))

      vi.doMock('@aws-sdk/s3-request-presigner', () => ({
        getSignedUrl: vi.fn().mockRejectedValue(new Error('S3 service unavailable')),
      }))

      const { POST } = await import('./route')

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

    it('should handle Azure Blob errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      vi.doMock('@/lib/uploads', () => ({
        getStorageProvider: vi.fn().mockReturnValue('blob'),
        isUsingCloudStorage: vi.fn().mockReturnValue(true),
        uploadFile: vi.fn().mockResolvedValue({
          path: '/api/files/serve/test-key',
          key: 'test-key',
          name: 'test.txt',
          size: 100,
          type: 'text/plain',
        }),
      }))

      vi.doMock('@/lib/uploads/blob/blob-client', () => ({
        getBlobServiceClient: vi.fn().mockImplementation(() => {
          throw new Error('Azure service unavailable')
        }),
        sanitizeFilenameForMetadata: vi.fn((filename) => filename),
      }))

      const { POST } = await import('./route')

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

    it('should handle malformed JSON gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('./route')

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
    it('should handle CORS preflight requests', async () => {
      const { OPTIONS } = await import('./route')

      const response = await OPTIONS()

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, DELETE, OPTIONS'
      )
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
    })
  })
})
