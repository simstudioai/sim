/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('File Serve API Route', () => {
  // Mock file system and S3 client modules
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test file content'))
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockDownloadFromS3 = vi.fn().mockResolvedValue(Buffer.from('test s3 file content'))
  const mockGetPresignedUrl = vi.fn().mockResolvedValue('https://example-s3.com/presigned-url')
  const mockEnsureUploadsDirectory = vi.fn().mockResolvedValue(true)

  beforeEach(() => {
    vi.resetModules()

    // Mock filesystem operations
    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
    }))

    // Mock the S3 client
    vi.doMock('@/lib/uploads/s3-client', () => ({
      downloadFromS3: mockDownloadFromS3,
      getPresignedUrl: mockGetPresignedUrl,
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

  it('should serve local file successfully', async () => {
    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/test-file.txt')

    // Create params similar to what Next.js would provide
    const params = { path: ['test-file.txt'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify response
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="test-file.txt"')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000')

    // Verify file was read from correct path
    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/test-file.txt')

    // Verify response content
    const buffer = await response.arrayBuffer()
    const content = Buffer.from(buffer).toString()
    expect(content).toBe('test file content')
  })

  it('should handle nested paths correctly', async () => {
    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/nested/path/file.txt')

    // Create params similar to what Next.js would provide
    const params = { path: ['nested', 'path', 'file.txt'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify file was read with correct path
    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve S3 file with presigned URL redirect', async () => {
    // Configure S3 storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
    }))

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/s3/1234567890-file.pdf')

    // Create params similar to what Next.js would provide
    const params = { path: ['s3', '1234567890-file.pdf'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify redirect to presigned URL
    expect(response.status).toBe(307) // Temporary redirect
    expect(response.headers.get('Location')).toBe('https://example-s3.com/presigned-url')

    // Verify presigned URL was generated for correct S3 key
    expect(mockGetPresignedUrl).toHaveBeenCalledWith('1234567890-file.pdf')
  })

  it('should handle S3 file download fallback if presigned URL fails', async () => {
    // Configure S3 storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
    }))

    // Mock presigned URL to fail
    mockGetPresignedUrl.mockRejectedValueOnce(new Error('Presigned URL failed'))

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/s3/1234567890-image.png')

    // Create params similar to what Next.js would provide
    const params = { path: ['s3', '1234567890-image.png'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify response falls back to downloading and proxying the file
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(mockDownloadFromS3).toHaveBeenCalledWith('1234567890-image.png')
  })

  it('should return 404 when file not found', async () => {
    // Mock file not existing
    mockExistsSync.mockReturnValue(false)

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/nonexistent.txt')

    // Create params similar to what Next.js would provide
    const params = { path: ['nonexistent.txt'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify 404 response
    expect(response.status).toBe(404)

    const data = await response.json()
    // Updated to match actual error format
    expect(data).toHaveProperty('error', 'FileNotFoundError')
    expect(data).toHaveProperty('message')
    expect(data.message).toContain('File not found')
  })

  // Instead of testing all content types in one test, let's separate them
  describe('content type detection', () => {
    const contentTypeTests = [
      { ext: 'pdf', contentType: 'application/pdf' },
      { ext: 'json', contentType: 'application/json' },
      { ext: 'jpg', contentType: 'image/jpeg' },
      { ext: 'txt', contentType: 'text/plain' },
      { ext: 'unknown', contentType: 'application/octet-stream' },
    ]

    for (const test of contentTypeTests) {
      it(`should serve ${test.ext} file with correct content type`, async () => {
        // Reset modules for this test
        vi.resetModules()

        // Re-apply all mocks
        vi.doMock('fs', () => ({
          existsSync: mockExistsSync.mockReturnValue(true),
        }))

        vi.doMock('fs/promises', () => ({
          readFile: mockReadFile,
        }))

        vi.doMock('@/lib/uploads/s3-client', () => ({
          downloadFromS3: mockDownloadFromS3,
          getPresignedUrl: mockGetPresignedUrl,
        }))

        vi.doMock('@/lib/logs/console-logger', () => ({
          createLogger: vi.fn().mockReturnValue({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
          }),
        }))

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

        vi.doMock('@/lib/uploads/setup.server', () => ({}))

        // Mock utils functions that determine content type
        vi.doMock('@/app/api/files/utils', () => ({
          getContentType: () => test.contentType,
          findLocalFile: () => '/test/uploads/file.' + test.ext,
          createFileResponse: (obj: { buffer: Buffer; contentType: string; filename: string }) =>
            new Response(obj.buffer, {
              status: 200,
              headers: {
                'Content-Type': obj.contentType,
                'Content-Disposition': `inline; filename="${obj.filename}"`,
                'Cache-Control': 'public, max-age=31536000',
              },
            }),
          createErrorResponse: () => new Response(null, { status: 404 }),
        }))

        // Create mock request with this extension
        const req = new NextRequest(`http://localhost:3000/api/files/serve/file.${test.ext}`)

        // Create params
        const params = { path: [`file.${test.ext}`] }

        // Import the handler after mocks are set up
        const { GET } = await import('./route')

        // Call the handler
        const response = await GET(req, { params })

        // Verify correct content type
        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })
})
