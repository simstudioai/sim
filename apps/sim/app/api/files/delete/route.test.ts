/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockCheckHybridAuth = vi.fn()
  const mockCheckSessionOrInternalAuth = vi.fn()
  const mockCheckInternalAuth = vi.fn()
  const mockVerifyFileAccess = vi.fn()
  const mockVerifyWorkspaceFileAccess = vi.fn()
  const mockDeleteFile = vi.fn()
  const mockHasCloudStorage = vi.fn()
  const mockGetStorageProvider = vi.fn()
  const mockIsUsingCloudStorage = vi.fn()
  const mockUploadFile = vi.fn()
  const mockDownloadFile = vi.fn()

  return {
    mockGetSession,
    mockCheckHybridAuth,
    mockCheckSessionOrInternalAuth,
    mockCheckInternalAuth,
    mockVerifyFileAccess,
    mockVerifyWorkspaceFileAccess,
    mockDeleteFile,
    mockHasCloudStorage,
    mockGetStorageProvider,
    mockIsUsingCloudStorage,
    mockUploadFile,
    mockDownloadFile,
  }
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@sim/db/schema', () => ({
  workflowFolder: {
    id: 'id',
    userId: 'userId',
    parentId: 'parentId',
    updatedAt: 'updatedAt',
    workspaceId: 'workspaceId',
    sortOrder: 'sortOrder',
    createdAt: 'createdAt',
  },
  workflow: { id: 'id', folderId: 'folderId', userId: 'userId', updatedAt: 'updatedAt' },
  account: { userId: 'userId', providerId: 'providerId' },
  user: { email: 'email', id: 'id' },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  gte: vi.fn((field: unknown, value: unknown) => ({ type: 'gte', field, value })),
  lte: vi.fn((field: unknown, value: unknown) => ({ type: 'lte', field, value })),
  gt: vi.fn((field: unknown, value: unknown) => ({ type: 'gt', field, value })),
  lt: vi.fn((field: unknown, value: unknown) => ({ type: 'lt', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ type: 'ne', field, value })),
  asc: vi.fn((field: unknown) => ({ field, type: 'asc' })),
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  inArray: vi.fn((field: unknown, values: unknown) => ({ field, values, type: 'inArray' })),
  notInArray: vi.fn((field: unknown, values: unknown) => ({ field, values, type: 'notInArray' })),
  like: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'like' })),
  ilike: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ilike' })),
  count: vi.fn((field: unknown) => ({ field, type: 'count' })),
  sum: vi.fn((field: unknown) => ({ field, type: 'sum' })),
  avg: vi.fn((field: unknown) => ({ field, type: 'avg' })),
  min: vi.fn((field: unknown) => ({ field, type: 'min' })),
  max: vi.fn((field: unknown) => ({ field, type: 'max' })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ type: 'sql', sql: strings, values })),
}))

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid'),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.mockGetSession,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mocks.mockCheckHybridAuth,
  checkSessionOrInternalAuth: mocks.mockCheckSessionOrInternalAuth,
  checkInternalAuth: mocks.mockCheckInternalAuth,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mocks.mockVerifyFileAccess,
  verifyWorkspaceFileAccess: mocks.mockVerifyWorkspaceFileAccess,
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: mocks.mockGetStorageProvider,
  isUsingCloudStorage: mocks.mockIsUsingCloudStorage,
  StorageService: {
    uploadFile: mocks.mockUploadFile,
    downloadFile: mocks.mockDownloadFile,
    deleteFile: mocks.mockDeleteFile,
    hasCloudStorage: mocks.mockHasCloudStorage,
  },
  uploadFile: mocks.mockUploadFile,
  downloadFile: mocks.mockDownloadFile,
  deleteFile: mocks.mockDeleteFile,
  hasCloudStorage: mocks.mockHasCloudStorage,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mocks.mockUploadFile,
  downloadFile: mocks.mockDownloadFile,
  deleteFile: mocks.mockDeleteFile,
  hasCloudStorage: mocks.mockHasCloudStorage,
}))

vi.mock('@/lib/uploads/setup.server', () => ({}))

vi.mock('fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}))

import { createMockRequest } from '@sim/testing'
import { OPTIONS, POST } from '@/app/api/files/delete/route'

describe('File Delete API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })

    mocks.mockGetSession.mockResolvedValue({ user: { id: 'test-user-id' } })
    mocks.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'test-user-id',
      error: undefined,
    })
    mocks.mockVerifyFileAccess.mockResolvedValue(true)
    mocks.mockVerifyWorkspaceFileAccess.mockResolvedValue(true)
    mocks.mockDeleteFile.mockResolvedValue(undefined)
    mocks.mockHasCloudStorage.mockReturnValue(true)
    mocks.mockGetStorageProvider.mockReturnValue('s3')
    mocks.mockIsUsingCloudStorage.mockReturnValue(true)
  })

  it('should handle local file deletion successfully', async () => {
    mocks.mockHasCloudStorage.mockReturnValue(false)
    mocks.mockGetStorageProvider.mockReturnValue('local')
    mocks.mockIsUsingCloudStorage.mockReturnValue(false)

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/test-file.txt',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message')
    expect(['File deleted successfully', "File not found, but that's okay"]).toContain(data.message)
  })

  it('should handle file not found gracefully', async () => {
    mocks.mockHasCloudStorage.mockReturnValue(false)
    mocks.mockGetStorageProvider.mockReturnValue('local')
    mocks.mockIsUsingCloudStorage.mockReturnValue(false)

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/nonexistent.txt',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message')
  })

  it('should handle S3 file deletion successfully', async () => {
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/1234567890-test-file.txt',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    expect(mocks.mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-test-file.txt',
      context: 'workspace',
    })
  })

  it('should handle Azure Blob file deletion successfully', async () => {
    mocks.mockGetStorageProvider.mockReturnValue('blob')

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/workspace/test-workspace-id/1234567890-test-document.pdf',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', true)
    expect(data).toHaveProperty('message', 'File deleted successfully')

    expect(mocks.mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-test-document.pdf',
      context: 'workspace',
    })
  })

  it('should handle missing file path', async () => {
    const req = createMockRequest('POST', {})

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No file path provided')
  })

  it('should handle CORS preflight requests', async () => {
    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})
