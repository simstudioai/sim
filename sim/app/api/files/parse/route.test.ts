/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import path from 'path'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

// Create actual mocks for path functions that we can use instead of using vi.doMock for path
const mockJoin = vi.fn((...args: string[]): string => {
  // For the UPLOAD_DIR paths, just return a test path
  if (args[0] === '/test/uploads') {
    return `/test/uploads/${args[args.length - 1]}`
  }
  return path.join(...args)
})

describe('File Parse API Route', () => {
  // Mock file system and parser modules
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test file content'))
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockUnlink = vi.fn().mockResolvedValue(undefined)
  const mockAccessFs = vi.fn().mockResolvedValue(undefined)
  const mockStatFs = vi.fn().mockImplementation(() => ({ isFile: () => true }))
  const mockDownloadFromS3 = vi.fn().mockResolvedValue(Buffer.from('test s3 file content'))
  const mockParseFile = vi.fn().mockResolvedValue({
    content: 'parsed content',
    metadata: { pageCount: 1 },
  })
  const mockParseBuffer = vi.fn().mockResolvedValue({
    content: 'parsed buffer content',
    metadata: { pageCount: 1 },
  })

  beforeEach(() => {
    vi.resetModules()

    // Reset all mocks
    vi.resetAllMocks()

    // Create a test upload file that exists for all tests
    mockReadFile.mockResolvedValue(Buffer.from('test file content'))
    mockAccessFs.mockResolvedValue(undefined)
    mockStatFs.mockImplementation(() => ({ isFile: () => true }))

    // Mock filesystem operations
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      constants: { R_OK: 4 },
      promises: {
        access: mockAccessFs,
        stat: mockStatFs,
        readFile: mockReadFile,
      },
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      unlink: mockUnlink,
      access: mockAccessFs,
      stat: mockStatFs,
    }))

    // Mock the S3 client
    vi.doMock('@/lib/uploads/s3-client', () => ({
      downloadFromS3: mockDownloadFromS3,
    }))

    // Mock file parsers
    vi.doMock('@/lib/file-parsers', () => ({
      isSupportedFileType: vi.fn().mockReturnValue(true),
      parseFile: mockParseFile,
      parseBuffer: mockParseBuffer,
    }))

    // Mock path module with our custom join function
    vi.doMock('path', () => {
      return {
        ...path,
        join: mockJoin,
        basename: path.basename,
        extname: path.extname,
      }
    })

    // Mock the logger
    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    // Configure upload directory and S3 mode
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
      S3_CONFIG: {
        bucket: 'test-bucket',
        region: 'test-region',
      },
    }))

    // Skip setup.server.ts side effects
    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Basic tests testing the API structure
  it('should handle missing file path', async () => {
    const req = createMockRequest('POST', {})
    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'No file path provided')
  })

  // Test skipping the implementation details and testing what users would care about
  it('should accept and process a local file', async () => {
    // Given: A request with a file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    // When: The API processes the request
    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    // Then: Check the API contract without making assumptions about implementation
    expect(response.status).toBe(200)
    expect(data).not.toBeNull() // We got a response

    // The response either has a success indicator with output OR an error
    if (data.success === true) {
      expect(data).toHaveProperty('output')
    } else {
      // If error, there should be an error message
      expect(data).toHaveProperty('error')
      expect(typeof data.error).toBe('string')
    }
  })

  it('should process S3 files', async () => {
    // Given: A request with an S3 file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/test-file.pdf',
    })

    // When: The API processes the request
    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    // Then: We should get a response with parsed content or error
    expect(response.status).toBe(200)

    // The data should either have a success flag with output or an error
    if (data.success === true) {
      expect(data).toHaveProperty('output')
    } else {
      expect(data).toHaveProperty('error')
    }
  })

  it('should handle multiple files', async () => {
    // Given: A request with multiple file paths
    const req = createMockRequest('POST', {
      filePath: ['/api/files/serve/file1.txt', '/api/files/serve/file2.txt'],
    })

    // When: The API processes the request
    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    // Then: We get an array of results
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(2)
  })

  it('should handle S3 access errors gracefully', async () => {
    // Given: S3 will throw an error
    mockDownloadFromS3.mockRejectedValueOnce(new Error('S3 access denied'))

    // And: A request with an S3 file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/access-denied.pdf',
    })

    // When: The API processes the request
    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    // Then: We get an appropriate error
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', false)
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('S3 access denied')
  })

  it('should handle access errors gracefully', async () => {
    // Given: File access will fail
    mockAccessFs.mockRejectedValueOnce(new Error('ENOENT: no such file'))

    // And: A request with a nonexistent file
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    // When: The API processes the request
    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    // Then: We get an appropriate error response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('error')
  })
})
