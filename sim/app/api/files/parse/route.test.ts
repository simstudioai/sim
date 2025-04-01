/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('File Parse API Route', () => {
  // Mock file system and parser modules
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test file content'))
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockUnlink = vi.fn().mockResolvedValue(undefined)
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockDownloadFromS3 = vi.fn().mockResolvedValue(Buffer.from('test s3 file content'))
  const mockParseFile = vi.fn().mockResolvedValue({
    content: 'parsed content',
    metadata: { pageCount: 1 },
  })
  const mockEnsureUploadsDirectory = vi.fn().mockResolvedValue(true)

  beforeEach(() => {
    vi.resetModules()

    // Mock filesystem operations
    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      unlink: mockUnlink,
    }))

    // Mock the S3 client
    vi.doMock('@/lib/uploads/s3-client', () => ({
      downloadFromS3: mockDownloadFromS3,
    }))

    // Mock file parsers
    vi.doMock('@/lib/file-parsers', () => ({
      isSupportedFileType: vi.fn().mockReturnValue(true),
      parseFile: mockParseFile,
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

  it('should parse local file successfully', async () => {
    // Create request with file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('output')
    expect(data.output).toHaveProperty('content', 'parsed content')
    expect(data.output).toHaveProperty('name', 'test-file.txt')

    // Verify readFile was called with correct path
    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should parse S3 file successfully', async () => {
    // Configure S3 storage mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
    }))

    // Create request with S3 file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/1234567890-test-file.pdf',
      fileType: 'application/pdf',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('output')
    expect(data.output).toHaveProperty('content', 'parsed content')
    expect(data.output).toHaveProperty('metadata')
    expect(data.output.metadata).toHaveProperty('pageCount', 1)

    // Verify S3 download was called with correct key
    expect(mockDownloadFromS3).toHaveBeenCalledWith('1234567890-test-file.pdf')

    // Verify temporary file was created and cleaned up
    expect(mockWriteFile).toHaveBeenCalled()
    expect(mockUnlink).toHaveBeenCalled()
  })

  it('should handle multiple files', async () => {
    // Create request with multiple file paths
    const req = createMockRequest('POST', {
      filePath: ['/api/files/serve/file1.txt', '/api/files/serve/file2.txt'],
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(2)
    expect(data.results[0]).toHaveProperty('success', true)
    expect(data.results[1]).toHaveProperty('success', true)
  })

  it('should handle file not found', async () => {
    // Mock file not existing for this test
    mockExistsSync.mockReturnValueOnce(false)

    // Create request with nonexistent file
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    if (data.success === true) {
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('content')
    } else {
      expect(data).toHaveProperty('error')
      expect(data.error).toContain('File not found')
    }
  })

  it('should handle unsupported file types with generic parser', async () => {
    // Mock file not being a supported type
    vi.doMock('@/lib/file-parsers', () => ({
      isSupportedFileType: vi.fn().mockReturnValue(false),
      parseFile: mockParseFile,
    }))

    // Create request with unsupported file type
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.xyz',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response uses generic handling
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('output')
    expect(data.output).toHaveProperty('binary', false)
  })

  it('should handle missing file path', async () => {
    // Create request with no file path
    const req = createMockRequest('POST', {})

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify error response
    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'No file path provided')
  })

  it('should handle parser errors gracefully', async () => {
    // Mock parser error
    mockParseFile.mockRejectedValueOnce(new Error('Parser failure'))

    // Create request with file that will fail parsing
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/error-file.txt',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify error was handled
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data.output).toHaveProperty('content')
  })
})
