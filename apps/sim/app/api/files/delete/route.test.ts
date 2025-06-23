import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupApiTestMocks } from '@/app/api/__test-utils__/utils'

describe('File Delete API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    setupApiTestMocks({
      withFileSystem: true,
      withUploadUtils: true,
    })

    vi.doMock('fs/promises', () => ({
      unlink: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 100, isFile: () => true }),
      access: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads', () => ({
      deleteFile: vi.fn().mockResolvedValue(undefined),
      isUsingCloudStorage: vi.fn().mockReturnValue(false),
      uploadFile: vi.fn().mockResolvedValue({
        path: '/api/files/serve/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      }),
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle local file deletion successfully', async () => {
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    const fs = await import('fs/promises')
    expect(fs.unlink).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should handle file not found gracefully', async () => {
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
    }))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', "File not found, but that's okay")

    const fs = await import('fs/promises')
    expect(fs.unlink).not.toHaveBeenCalled()
  })

  it('should handle S3 file deletion successfully', async () => {
    vi.doMock('@/lib/uploads', () => ({
      deleteFile: vi.fn().mockResolvedValue(undefined),
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
      uploadFile: vi.fn().mockResolvedValue({
        path: '/api/files/serve/s3/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      }),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/1234567890-test-file.txt',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully from cloud storage')

    const uploads = await import('@/lib/uploads')
    expect(uploads.deleteFile).toHaveBeenCalledWith('1234567890-test-file.txt')
  })

  it('should handle Azure Blob file deletion successfully', async () => {
    vi.doMock('@/lib/uploads', () => ({
      deleteFile: vi.fn().mockResolvedValue(undefined),
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
      uploadFile: vi.fn().mockResolvedValue({
        path: '/api/files/serve/blob/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      }),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
      USE_BLOB_STORAGE: true,
    }))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/blob/1234567890-test-document.pdf',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully from cloud storage')

    const uploads = await import('@/lib/uploads')
    expect(uploads.deleteFile).toHaveBeenCalledWith('1234567890-test-document.pdf')
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
