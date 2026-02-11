import {
  createMockRequest,
  mockAuth,
  mockCryptoUuid,
  mockUuid,
  setupCommonApiMocks,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Setup file API mocks for file delete tests */
function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  setupCommonApiMocks()
  mockUuid()
  mockCryptoUuid()

  const authMocks = mockAuth()
  if (authenticated) {
    authMocks.setAuthenticated()
  } else {
    authMocks.setUnauthenticated()
  }

  vi.doMock('@/lib/auth/hybrid', () => ({
    checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
      success: authenticated,
      userId: authenticated ? 'test-user-id' : undefined,
      error: authenticated ? undefined : 'Unauthorized',
    }),
  }))

  vi.doMock('@/app/api/files/authorization', () => ({
    verifyFileAccess: vi.fn().mockResolvedValue(true),
    verifyWorkspaceFileAccess: vi.fn().mockResolvedValue(true),
  }))

  const uploadFileMock = vi.fn().mockResolvedValue({
    path: '/api/files/serve/test-key.txt',
    key: 'test-key.txt',
    name: 'test.txt',
    size: 100,
    type: 'text/plain',
  })
  const downloadFileMock = vi.fn().mockResolvedValue(Buffer.from('test content'))
  const deleteFileMock = vi.fn().mockResolvedValue(undefined)
  const hasCloudStorageMock = vi.fn().mockReturnValue(cloudEnabled)

  vi.doMock('@/lib/uploads', () => ({
    getStorageProvider: vi.fn().mockReturnValue(storageProvider),
    isUsingCloudStorage: vi.fn().mockReturnValue(cloudEnabled),
    StorageService: {
      uploadFile: uploadFileMock,
      downloadFile: downloadFileMock,
      deleteFile: deleteFileMock,
      hasCloudStorage: hasCloudStorageMock,
    },
    uploadFile: uploadFileMock,
    downloadFile: downloadFileMock,
    deleteFile: deleteFileMock,
    hasCloudStorage: hasCloudStorageMock,
  }))

  vi.doMock('@/lib/uploads/core/storage-service', () => ({
    uploadFile: uploadFileMock,
    downloadFile: downloadFileMock,
    deleteFile: deleteFileMock,
    hasCloudStorage: hasCloudStorageMock,
  }))

  vi.doMock('fs/promises', () => ({
    unlink: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isFile: () => true }),
  }))

  return { auth: authMocks }
}

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
