import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('File Delete API Route', () => {
  // Mock file system and storage modules
  const mockUnlink = vi.fn().mockResolvedValue(undefined)
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockDeleteFile = vi.fn().mockResolvedValue(undefined)
  const mockIsUsingCloudStorage = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.resetModules()

    // Mock filesystem operations
    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      unlink: mockUnlink,
    }))

    // Mock the storage abstraction layer
    vi.doMock('@/lib/uploads', () => ({
      deleteFile: mockDeleteFile,
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
    }))

    // Skip setup.server.ts side effects
    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle local file deletion successfully', async () => {
    // Configure upload directory and S3 mode for this test
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
    }))

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
    expect(data).toHaveProperty('message', 'File deleted successfully')

    // Verify unlink was called with correct path
    expect(mockUnlink).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should handle file not found gracefully', async () => {
    // Mock file not existing
    mockExistsSync.mockReturnValueOnce(false)

    // Create request with file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', "File not found, but that's okay")

    // Verify unlink was not called
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('should handle S3 file deletion successfully', async () => {
    // Configure upload directory and S3 mode for this test
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    // Mock cloud storage mode
    mockIsUsingCloudStorage.mockReturnValue(true)

    // Create request with S3 file path
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/1234567890-test-file.txt',
    })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req)
    const data = await response.json()

    // Verify response
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully from cloud storage')

    // Verify deleteFile was called with correct key
    expect(mockDeleteFile).toHaveBeenCalledWith('1234567890-test-file.txt')
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
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No file path provided')
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
