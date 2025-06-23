import { NextRequest } from 'next/server'
/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockUploadUtils, mockUuid, setupApiTestMocks } from '@/app/api/__test-utils__/utils'

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

    setupApiTestMocks({
      withFileSystem: true,
      withUploadUtils: true,
    })

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
    expect(data).toHaveProperty('path', '/api/files/serve/test-uuid.txt')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')

    const fs = await import('fs/promises')
    expect(fs.writeFile).toHaveBeenCalledWith('/test/uploads/test-uuid.txt', expect.any(Buffer))
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    mockUploadUtils({
      isCloudStorage: true,
      uploadResult: {
        path: '/api/files/serve/s3/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      },
    })

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

    const uploads = await import('@/lib/uploads')
    expect(uploads.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      'test.txt',
      'text/plain',
      expect.any(Number)
    )
  })

  it('should handle multiple file uploads', async () => {
    mockUuid('test-uuid-1')

    const mockFile1 = createMockFile('file1.txt', 'text/plain')
    const mockFile2 = createMockFile('file2.txt', 'text/plain')
    const formData = createMockFormData([mockFile1, mockFile2])

    const uploads = await import('@/lib/uploads')
    const mockUploadFile = uploads.uploadFile as any
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
    mockUploadUtils({
      isCloudStorage: true,
      uploadError: true,
    })

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
