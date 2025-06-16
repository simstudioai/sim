import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('File Delete API Route', () => {
  const mockUnlink = vi.fn().mockResolvedValue(undefined)
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockDeleteFile = vi.fn().mockResolvedValue(undefined)
  const mockIsUsingCloudStorage = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      unlink: mockUnlink,
    }))

    vi.doMock('@/lib/uploads', () => ({
      deleteFile: mockDeleteFile,
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
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle local file deletion successfully', async () => {
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
    }))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    expect(mockUnlink).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should handle file not found gracefully', async () => {
    mockExistsSync.mockReturnValueOnce(false)

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', "File not found, but that's okay")

    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('should handle S3 file deletion successfully', async () => {
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    mockIsUsingCloudStorage.mockReturnValue(true)

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/1234567890-test-file.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully from cloud storage')

    expect(mockDeleteFile).toHaveBeenCalledWith('1234567890-test-file.txt')
  })

  it('should handle missing file path', async () => {
    const req = createMockRequest('POST', {})

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No file path provided')
  })

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('./route')

    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})
