import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupFileApiMocks } from '@/app/api/__test-utils__/utils'

describe('File Delete API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle local file deletion successfully', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/test-file.txt',
    })

    const { POST } = await import('@/app/api/files/delete/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message')
    expect(['File deleted successfully', "File not found, but that's okay"]).toContain(data.message)
  })

  it('should handle file not found gracefully', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/nonexistent.txt',
    })

    const { POST } = await import('@/app/api/files/delete/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message')
  })

  it('should handle S3 file deletion successfully', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/1234567890-test-file.txt',
    })

    const { POST } = await import('@/app/api/files/delete/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    const storageService = await import('@/lib/uploads/core/storage-service')
    expect(storageService.deleteFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-test-file.txt',
      context: 'workspace',
    })
  })

  it('should handle Azure Blob file deletion successfully', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'blob',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/1234567890-test-document.pdf',
    })

    const { POST } = await import('@/app/api/files/delete/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    const storageService = await import('@/lib/uploads/core/storage-service')
    expect(storageService.deleteFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-test-document.pdf',
      context: 'workspace',
    })
  })

  it('should handle missing file path', async () => {
    setupFileApiMocks()

    const req = createMockRequest('POST', {})

    const { POST } = await import('@/app/api/files/delete/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No file path provided')
  })

  it('should handle CORS preflight requests', async () => {
    const { OPTIONS } = await import('@/app/api/files/delete/route')

    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})
