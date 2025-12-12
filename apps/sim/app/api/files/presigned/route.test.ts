import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'

/**
 * Tests for file presigned API route
 *
 * @vitest-environment node
 */

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
    it('should return graceful fallback response when cloud storage is not enabled', async () => {
      setupFileApiMocks({
        cloudEnabled: false,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.directUploadSupported).toBe(false)
      expect(data.presignedUrl).toBe('')
      expect(data.fileName).toBe('test.txt')
      expect(data.fileInfo).toBeDefined()
      expect(data.fileInfo.name).toBe('test.txt')
      expect(data.fileInfo.size).toBe(1024)
      expect(data.fileInfo.type).toBe('text/plain')
    })

    it('should return error when fileName is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

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
      expect(data.error).toBe('fileName is required and cannot be empty')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when contentType is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

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
      expect(data.error).toBe('contentType is required and cannot be empty')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when fileSize is invalid', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 0,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('fileSize must be a positive number')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when file size exceeds limit', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const largeFileSize = 150 * 1024 * 1024 // 150MB (exceeds 100MB limit)
      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'large-file.txt',
          contentType: 'text/plain',
          fileSize: largeFileSize,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('exceeds maximum allowed size')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should generate S3 presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
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
        path: expect.stringMatching(/\/api\/files\/serve\/s3\/.+\?context=chat$/),
        key: expect.stringMatching(/.*test.document\.txt$/),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate knowledge-base S3 presigned URL with kb prefix', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest(
        'http://localhost:3000/api/files/presigned?type=knowledge-base',
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: 'knowledge-doc.pdf',
            contentType: 'application/pdf',
            fileSize: 2048,
          }),
        }
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^kb\/.*knowledge-doc\.pdf$/)
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate chat S3 presigned URL with chat prefix and direct path', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'chat-logo.png',
          contentType: 'image/png',
          fileSize: 4096,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^chat\/.*chat-logo\.png$/)
      expect(data.fileInfo.path).toMatch(/\/api\/files\/serve\/s3\/.+\?context=chat$/)
      expect(data.presignedUrl).toBeTruthy()
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate Azure Blob presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
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
      expect(data.presignedUrl).toBeTruthy()
      expect(typeof data.presignedUrl).toBe('string')
      expect(data.fileInfo).toMatchObject({
        key: expect.stringMatching(/.*test.document\.txt$/),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate chat Azure Blob presigned URL with chat prefix and direct path', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'chat-logo.png',
          contentType: 'image/png',
          fileSize: 4096,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^chat\/.*chat-logo\.png$/)
      expect(data.fileInfo.path).toMatch(/\/api\/files\/serve\/blob\/.+\?context=chat$/)
      expect(data.presignedUrl).toBeTruthy()
      expect(data.directUploadSupported).toBe(true)
    })

    it('should return error for unknown storage provider', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      vi.doMock('@/lib/uploads/core/storage-service', () => ({
        hasCloudStorage: vi.fn().mockReturnValue(true),
        generatePresignedUploadUrl: vi
          .fn()
          .mockRejectedValue(new Error('Unknown storage provider: unknown')),
      }))

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
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
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle S3 errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      vi.doMock('@/lib/uploads/core/storage-service', () => ({
        hasCloudStorage: vi.fn().mockReturnValue(true),
        generatePresignedUploadUrl: vi.fn().mockRejectedValue(new Error('S3 service unavailable')),
      }))

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
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
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle Azure Blob errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      vi.doMock('@/lib/uploads/core/storage-service', () => ({
        hasCloudStorage: vi.fn().mockReturnValue(true),
        generatePresignedUploadUrl: vi
          .fn()
          .mockRejectedValue(new Error('Azure service unavailable')),
      }))

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
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
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle malformed JSON gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const { POST } = await import('@/app/api/files/presigned/route')

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: 'invalid json',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400) // Changed from 500 to 400 (ValidationError)
      expect(data.error).toBe('Invalid JSON in request body') // Updated error message
      expect(data.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('OPTIONS', () => {
    it('should handle CORS preflight requests', async () => {
      const { OPTIONS } = await import('@/app/api/files/presigned/route')

      const response = await OPTIONS()

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization'
      )
    })
  })
})
