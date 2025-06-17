import { NextRequest } from 'next/server'
/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('File Upload API Route', () => {
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockUploadFile = vi.fn().mockResolvedValue({
    path: '/api/files/serve/s3/test-key',
    key: 'test-key',
    name: 'test.txt',
    size: 100,
    type: 'text/plain',
  })
  const mockIsUsingCloudStorage = vi.fn().mockReturnValue(false)
  const mockEnsureUploadsDirectory = vi.fn().mockResolvedValue(true)

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

    vi.doMock('fs/promises', () => ({
      writeFile: mockWriteFile,
    }))

    vi.doMock('@/lib/uploads', () => ({
      uploadFile: mockUploadFile,
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

    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-uuid'),
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should upload a file to local storage', async () => {
    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path', '/api/files/serve/mock-uuid.txt')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    expect(mockWriteFile).toHaveBeenCalledWith('/test/uploads/mock-uuid.txt', expect.any(Buffer))
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    mockIsUsingCloudStorage.mockReturnValue(true)

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('path')
    expect(data.path).toContain('/api/files/serve/s3/')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      'test.txt',
      'text/plain',
      expect.any(Number)
    )
  })

  it('should handle multiple file uploads', async () => {
    const mockFile1 = createMockFile('file1.txt', 'text/plain')
    const mockFile2 = createMockFile('file2.txt', 'text/plain')
    const formData = createMockFormData([mockFile1, mockFile2])

    mockUploadFile
      .mockResolvedValueOnce({
        path: '/api/files/serve/test1.txt',
        key: 'test1.txt',
        name: 'file1.txt',
        size: 100,
        type: 'text/plain',
      })
      .mockResolvedValueOnce({
        path: '/api/files/serve/test2.txt',
        key: 'test2.txt',
        name: 'file2.txt',
        size: 100,
        type: 'text/plain',
      })

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('files')
    expect(Array.isArray(data.files)).toBe(true)
    expect(data.files).toHaveLength(2)

    expect(data.files[0]).toHaveProperty('name', 'file1.txt')
    expect(data.files[1]).toHaveProperty('name', 'file2.txt')
  })

  it('should handle missing files', async () => {
    const formData = new FormData()

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    mockIsUsingCloudStorage.mockReturnValue(true)

    mockUploadFile.mockRejectedValueOnce(new Error('Upload failed'))

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toHaveProperty('error', 'Error')
    expect(data).toHaveProperty('message', 'Upload failed')
  })

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('./route')

    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})
