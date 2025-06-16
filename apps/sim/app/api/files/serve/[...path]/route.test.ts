import { NextRequest } from 'next/server'
/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('File Serve API Route', () => {
  // Mock file system and storage modules
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test file content'))
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockDownloadFile = vi.fn().mockResolvedValue(Buffer.from('test cloud file content'))
  const mockGetPresignedUrl = vi.fn().mockResolvedValue('https://example-s3.com/presigned-url')
  const mockIsUsingCloudStorage = vi.fn().mockReturnValue(false)
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

    // Mock the storage abstraction layer
    vi.doMock('@/lib/uploads', () => ({
      downloadFile: mockDownloadFile,
      getPresignedUrl: mockGetPresignedUrl,
      isUsingCloudStorage: mockIsUsingCloudStorage,
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

    // Configure upload directory and storage mode with all required exports
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
      USE_BLOB_STORAGE: false,
      ensureUploadsDirectory: mockEnsureUploadsDirectory,
      S3_CONFIG: {
        bucket: 'test-bucket',
        region: 'test-region',
      },
    }))

    // Mock the file utils with all exports including FileNotFoundError
    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
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
    const response = await GET(req, { params: Promise.resolve(params) })

    // Verify response
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="test-file.txt"')

    // Verify file was read from correct path
    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should handle nested paths correctly', async () => {
    // Mock findLocalFile to return the nested path
    const mockFindLocalFile = vi.fn().mockReturnValue('/test/uploads/nested/path/file.txt')

    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: mockFindLocalFile,
    }))

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/nested/path/file.txt')

    // Create params similar to what Next.js would provide
    const params = { path: ['nested', 'path', 'file.txt'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params: Promise.resolve(params) })

    // Verify response
    expect(response.status).toBe(200)

    // Verify file was read with correct path
    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve cloud file by downloading and proxying', async () => {
    // Configure cloud storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    // Mock cloud storage mode
    mockIsUsingCloudStorage.mockReturnValue(true)

    // Mock content type detection for PNG
    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('image/png'),
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
    }))

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/s3/1234567890-image.png')

    // Create params similar to what Next.js would provide
    const params = { path: ['s3', '1234567890-image.png'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params: Promise.resolve(params) })

    // Verify response downloads and proxies the file
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(mockDownloadFile).toHaveBeenCalledWith('1234567890-image.png')
  })

  it('should return 404 when file not found', async () => {
    // Mock readFile to throw an error for this specific test
    const mockReadFileError = vi
      .fn()
      .mockRejectedValue(new Error('ENOENT: no such file or directory'))

    // Reset modules for this specific test
    vi.resetModules()

    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false), // File doesn't exist
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFileError, // This will throw an error
    }))

    vi.doMock('@/lib/uploads', () => ({
      downloadFile: mockDownloadFile,
      getPresignedUrl: mockGetPresignedUrl,
      isUsingCloudStorage: vi.fn().mockReturnValue(false), // Use local storage
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
      USE_BLOB_STORAGE: false,
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))

    // Mock utils with findLocalFile returning null to trigger FileNotFoundError
    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn(),
      createErrorResponse: vi.fn(),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn(),
      extractBlobKey: vi.fn(),
      extractFilename: vi.fn(),
      findLocalFile: vi.fn().mockReturnValue(null), // This should trigger FileNotFoundError
    }))

    // Create mock request
    const req = new NextRequest('http://localhost:3000/api/files/serve/nonexistent.txt')

    // Create params similar to what Next.js would provide
    const params = { path: ['nonexistent.txt'] }

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params: Promise.resolve(params) })

    // Verify 404 response
    expect(response.status).toBe(404)

    const text = await response.text()
    expect(text).toBe('File not found')
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

        vi.doMock('@/lib/uploads', () => ({
          downloadFile: mockDownloadFile,
          getPresignedUrl: mockGetPresignedUrl,
          isUsingCloudStorage: mockIsUsingCloudStorage,
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
          USE_BLOB_STORAGE: false,
          ensureUploadsDirectory: mockEnsureUploadsDirectory,
          S3_CONFIG: {
            bucket: 'test-bucket',
            region: 'test-region',
          },
        }))

        vi.doMock('@/lib/uploads/setup.server', () => ({}))

        // Mock utils functions that determine content type
        vi.doMock('@/app/api/files/utils', () => ({
          getContentType: () => test.contentType,
          findLocalFile: () => `/test/uploads/file.${test.ext}`,
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
        const response = await GET(req, { params: Promise.resolve(params) })

        // Verify correct content type
        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })
})
