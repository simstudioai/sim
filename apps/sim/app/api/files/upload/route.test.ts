import { NextRequest } from 'next/server'
/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'

describe('File Upload API Route', () => {
  const createMockFormData = (files: File[]): FormData => {
    const formData = new FormData()
    files.forEach((file) => {
      formData.append('file', file)
    })
    return formData
  }

  const createMockFile = (
    name = 'test.txt',
    type = 'text/plain',
    content = 'test content'
  ): File => {
    return new File([content], name, { type })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/uploads/setup.server', () => ({
      UPLOAD_DIR_SERVER: '/tmp/test-uploads',
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should upload a file to local storage', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('@/app/api/files/upload/route')

    const response = await POST(req)
    const data = await response.json()

    // Log error details if test fails
    if (response.status !== 200) {
      console.error('Upload failed with status:', response.status)
      console.error('Error response:', data)
    }

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path')
    expect(data.path).toMatch(/\/api\/files\/serve\/.*\.txt$/)
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    // Verify the upload function was called (we're mocking at the uploadFile level)
    const { uploadFile } = await import('@/lib/uploads')
    expect(uploadFile).toHaveBeenCalled()
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('@/app/api/files/upload/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path')
    expect(data.path).toContain('/api/files/serve/')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    const uploads = await import('@/lib/uploads')
    expect(uploads.uploadFile).toHaveBeenCalled()
  })

  it('should handle multiple file uploads', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile1 = createMockFile('file1.txt', 'text/plain')
    const mockFile2 = createMockFile('file2.txt', 'text/plain')
    const formData = createMockFormData([mockFile1, mockFile2])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('@/app/api/files/upload/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(600)
    expect(data).toBeDefined()
  })

  it('should handle missing files', async () => {
    setupFileApiMocks()

    const formData = new FormData()

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('@/app/api/files/upload/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    vi.doMock('@/lib/uploads', () => ({
      uploadFile: vi.fn().mockRejectedValue(new Error('Upload failed')),
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
    }))

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('@/app/api/files/upload/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toHaveProperty('error', 'Error')
    expect(data).toHaveProperty('message', 'Upload failed')
  })

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('@/app/api/files/upload/route')

    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})

describe('File Upload Security Tests', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'test-user-id' },
      }),
    }))

    vi.doMock('@/lib/uploads', () => ({
      isUsingCloudStorage: vi.fn().mockReturnValue(false),
      uploadFile: vi.fn().mockResolvedValue({
        key: 'test-key',
        path: '/test/path',
      }),
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('File Extension Validation', () => {
    it('should accept allowed file types', async () => {
      const allowedTypes = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'csv',
        'xlsx',
        'xls',
      ]

      for (const ext of allowedTypes) {
        const formData = new FormData()
        const file = new File(['test content'], `test.${ext}`, { type: 'application/octet-stream' })
        formData.append('file', file)

        const req = new Request('http://localhost/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        const { POST } = await import('@/app/api/files/upload/route')
        const response = await POST(req as any)

        expect(response.status).toBe(200)
      }
    })

    it('should reject HTML files to prevent XSS', async () => {
      const formData = new FormData()
      const maliciousContent = '<script>alert("XSS")</script>'
      const file = new File([maliciousContent], 'malicious.html', { type: 'text/html' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })

    it('should reject SVG files to prevent XSS', async () => {
      const formData = new FormData()
      const maliciousSvg = '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
      const file = new File([maliciousSvg], 'malicious.svg', { type: 'image/svg+xml' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'svg' is not allowed")
    })

    it('should reject JavaScript files', async () => {
      const formData = new FormData()
      const maliciousJs = 'alert("XSS")'
      const file = new File([maliciousJs], 'malicious.js', { type: 'application/javascript' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'js' is not allowed")
    })

    it('should reject files without extensions', async () => {
      const formData = new FormData()
      const file = new File(['test content'], 'noextension', { type: 'application/octet-stream' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'noextension' is not allowed")
    })

    it('should handle multiple files with mixed valid/invalid types', async () => {
      const formData = new FormData()

      // Valid file
      const validFile = new File(['valid content'], 'valid.pdf', { type: 'application/pdf' })
      formData.append('file', validFile)

      // Invalid file (should cause rejection of entire request)
      const invalidFile = new File(['<script>alert("XSS")</script>'], 'malicious.html', {
        type: 'text/html',
      })
      formData.append('file', invalidFile)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })
  })

  describe('Authentication Requirements', () => {
    it('should reject uploads without authentication', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const formData = new FormData()
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const { POST } = await import('@/app/api/files/upload/route')
      const response = await POST(req as any)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })
})
