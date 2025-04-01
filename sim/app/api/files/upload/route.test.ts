/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('File Upload API Route', () => {
  // Mock file system and S3 client modules
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockUploadToS3 = vi.fn().mockImplementation((buffer, fileName) => {
    return Promise.resolve({
      path: `/api/files/serve/s3/${Date.now()}-${fileName}`,
      key: `${Date.now()}-${fileName}`,
      name: fileName,
      size: buffer.length,
      type: 'text/plain',
    })
  })
  const mockEnsureUploadsDirectory = vi.fn().mockResolvedValue(true)

  // Mock form data
  const createMockFormData = (files: File[]): FormData => {
    const formData = new FormData()
    files.forEach((file) => {
      formData.append('file', file)
    })
    return formData
  }

  // Mock file
  const createMockFile = (
    name = 'test.txt',
    type = 'text/plain',
    content = 'test content'
  ): File => {
    return new File([content], name, { type })
  }

  beforeEach(() => {
    vi.resetModules()

    // Mock filesystem operations
    vi.doMock('fs/promises', () => ({
      writeFile: mockWriteFile,
    }))

    // Mock the S3 client
    vi.doMock('@/lib/uploads/s3-client', () => ({
      uploadToS3: mockUploadToS3,
    }))

    // Mock the logger
    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    // Mock UUID generation
    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-uuid'),
    }))

    // Configure upload directory and S3 mode with all required exports
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
      ensureUploadsDirectory: mockEnsureUploadsDirectory,
      S3_CONFIG: {
        bucket: 'test-bucket',
        region: 'test-region',
        baseUrl: 'https://test-bucket.s3.test-region.amazonaws.com',
      },
    }))

    // Skip setup.server.ts side effects
    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should upload a file to local storage', async () => {
    // Create a mock request with file
    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    // Create mock request object
    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path', '/api/files/serve/mock-uuid.txt')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    // Verify file was written to local storage
    expect(mockWriteFile).toHaveBeenCalledWith('/test/uploads/mock-uuid.txt', expect.any(Buffer))
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    // Configure S3 storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
    }))

    // Create a mock request with file
    const mockFile = createMockFile('document.pdf', 'application/pdf')
    const formData = createMockFormData([mockFile])

    // Create mock request object
    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path')
    expect(data.path).toContain('/api/files/serve/s3/')
    expect(data).toHaveProperty('key')
    expect(data).toHaveProperty('name', 'document.pdf')

    // Verify uploadToS3 was called with correct parameters
    expect(mockUploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      'document.pdf',
      'application/pdf',
      expect.any(Number)
    )

    // Verify local write was NOT called
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('should handle multiple file uploads', async () => {
    // Create multiple mock files
    const mockFiles = [
      createMockFile('file1.txt', 'text/plain'),
      createMockFile('file2.jpg', 'image/jpeg'),
    ]
    const formData = createMockFormData(mockFiles)

    // Create mock request object
    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response has multiple results
    expect(response.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    expect(data[0]).toHaveProperty('name', 'file1.txt')
    expect(data[1]).toHaveProperty('name', 'file2.jpg')

    // Verify files were written
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
  })

  it('should handle missing files', async () => {
    // Create empty form data
    const formData = new FormData()

    // Create mock request object
    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify error response
    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    // Configure S3 storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
    }))

    // Mock S3 upload failure
    mockUploadToS3.mockRejectedValueOnce(new Error('S3 upload failed'))

    // Create a mock request with file
    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    // Create mock request object
    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify error response
    expect(response.status).toBe(500)
    expect(data).toHaveProperty('error', 'Error')
    expect(data).toHaveProperty('message', 'S3 upload failed')
  })

  it('should handle CORS preflight requests', async () => {
    // Import the handler after mocks are set up
    const { OPTIONS } = await import('./route')

    // Call the handler
    const response = await OPTIONS()

    // Verify response
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})
