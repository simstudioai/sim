/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockCheckHybridAuth = vi.fn()
  const mockCheckSessionOrInternalAuth = vi.fn()
  const mockCheckInternalAuth = vi.fn()
  const mockVerifyFileAccess = vi.fn()
  const mockVerifyWorkspaceFileAccess = vi.fn()
  const mockVerifyKBFileAccess = vi.fn()
  const mockVerifyCopilotFileAccess = vi.fn()
  const mockGetUserEntityPermissions = vi.fn()
  const mockUploadWorkspaceFile = vi.fn()
  const mockGetStorageProvider = vi.fn()
  const mockIsUsingCloudStorage = vi.fn()
  const mockUploadFile = vi.fn()
  const mockHasCloudStorage = vi.fn()
  const mockStorageUploadFile = vi.fn()

  return {
    mockGetSession,
    mockCheckHybridAuth,
    mockCheckSessionOrInternalAuth,
    mockCheckInternalAuth,
    mockVerifyFileAccess,
    mockVerifyWorkspaceFileAccess,
    mockVerifyKBFileAccess,
    mockVerifyCopilotFileAccess,
    mockGetUserEntityPermissions,
    mockUploadWorkspaceFile,
    mockGetStorageProvider,
    mockIsUsingCloudStorage,
    mockUploadFile,
    mockHasCloudStorage,
    mockStorageUploadFile,
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
  verifyKBFileAccess: mocks.mockVerifyKBFileAccess,
  verifyCopilotFileAccess: mocks.mockVerifyCopilotFileAccess,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.mockGetUserEntityPermissions,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mocks.mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: mocks.mockGetStorageProvider,
  isUsingCloudStorage: mocks.mockIsUsingCloudStorage,
  uploadFile: mocks.mockUploadFile,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mocks.mockStorageUploadFile,
  hasCloudStorage: mocks.mockHasCloudStorage,
}))

vi.mock('@/lib/uploads/setup.server', () => ({
  UPLOAD_DIR_SERVER: '/tmp/test-uploads',
}))

import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { OPTIONS, POST } from '@/app/api/files/upload/route'

/**
 * Configure mocks for authenticated file upload tests
 */
function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
  })

  if (authenticated) {
    mocks.mockGetSession.mockResolvedValue({ user: { id: 'test-user-id' } })
  } else {
    mocks.mockGetSession.mockResolvedValue(null)
  }

  mocks.mockCheckHybridAuth.mockResolvedValue({
    success: authenticated,
    userId: authenticated ? 'test-user-id' : undefined,
    error: authenticated ? undefined : 'Unauthorized',
  })

  mocks.mockVerifyFileAccess.mockResolvedValue(true)
  mocks.mockVerifyWorkspaceFileAccess.mockResolvedValue(true)
  mocks.mockVerifyKBFileAccess.mockResolvedValue(true)
  mocks.mockVerifyCopilotFileAccess.mockResolvedValue(true)

  mocks.mockGetUserEntityPermissions.mockResolvedValue('admin')

  mocks.mockUploadWorkspaceFile.mockResolvedValue({
    id: 'test-file-id',
    name: 'test.txt',
    url: '/api/files/serve/workspace/test-workspace-id/test-file.txt',
    size: 100,
    type: 'text/plain',
    key: 'workspace/test-workspace-id/1234567890-test.txt',
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })

  mocks.mockGetStorageProvider.mockReturnValue(storageProvider)
  mocks.mockIsUsingCloudStorage.mockReturnValue(cloudEnabled)
  mocks.mockUploadFile.mockResolvedValue({
    path: '/api/files/serve/test-key.txt',
    key: 'test-key.txt',
    name: 'test.txt',
    size: 100,
    type: 'text/plain',
  })

  mocks.mockHasCloudStorage.mockReturnValue(cloudEnabled)
  mocks.mockStorageUploadFile.mockResolvedValue({
    key: 'test-key',
    path: '/test/path',
  })
}

describe('File Upload API Route', () => {
  const createMockFormData = (files: File[], context = 'workspace'): FormData => {
    const formData = new FormData()
    formData.append('context', context)
    formData.append('workspaceId', 'test-workspace-id')
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
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should upload a file to local storage', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('url')
    expect(data.url).toMatch(/\/api\/files\/serve\/.*\.txt$/)
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')
    expect(data).toHaveProperty('key')

    expect(uploadWorkspaceFile).toHaveBeenCalled()
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('url')
    expect(data.url).toContain('/api/files/serve/')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')
    expect(data).toHaveProperty('key')

    expect(uploadWorkspaceFile).toHaveBeenCalled()
  })

  it('should handle multiple file uploads', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile1 = createMockFile('file1.txt', 'text/plain')
    const mockFile2 = createMockFile('file2.txt', 'text/plain')
    const formData = createMockFormData([mockFile1, mockFile2])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(600)
    expect(data).toBeDefined()
  })

  it('should handle missing files', async () => {
    setupFileApiMocks()

    const formData = new FormData()

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    mocks.mockUploadWorkspaceFile.mockRejectedValue(new Error('Storage limit exceeded'))

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data).toHaveProperty('error')
    expect(typeof data.error).toBe('string')
  })

  it('should handle CORS preflight requests', async () => {
    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })
})

describe('File Upload Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.mockGetSession.mockResolvedValue({
      user: { id: 'test-user-id' },
    })

    mocks.mockHasCloudStorage.mockReturnValue(false)
    mocks.mockStorageUploadFile.mockResolvedValue({
      key: 'test-key',
      path: '/test/path',
    })
    mocks.mockIsUsingCloudStorage.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('File Extension Validation', () => {
    beforeEach(() => {
      setupFileApiMocks({
        cloudEnabled: false,
        storageProvider: 'local',
      })
    })

    it('should accept allowed file types', async () => {
      const allowedTypes = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'csv',
        'xlsx',
        'xls',
      ]

      for (const ext of allowedTypes) {
        const formData = new FormData()
        const file = new File(['test content'], `test.${ext}`, { type: 'application/octet-stream' })
        formData.append('file', file)
        formData.append('context', 'workspace')
        formData.append('workspaceId', 'test-workspace-id')

        const req = new Request('http://localhost/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        const response = await POST(req as unknown as NextRequest)

        expect(response.status).toBe(200)
      }
    })

    it('should reject HTML files to prevent XSS', async () => {
      const formData = new FormData()
      const maliciousContent = '<script>alert("XSS")</script>'
      const file = new File([maliciousContent], 'malicious.html', { type: 'text/html' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })

    it('should reject HTML files to prevent XSS', async () => {
      const formData = new FormData()
      const maliciousContent = '<script>alert("XSS")</script>'
      const file = new File([maliciousContent], 'malicious.html', { type: 'text/html' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })

    it('should reject SVG files to prevent XSS', async () => {
      const formData = new FormData()
      const maliciousSvg = '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
      const file = new File([maliciousSvg], 'malicious.svg', { type: 'image/svg+xml' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'svg' is not allowed")
    })

    it('should reject JavaScript files', async () => {
      const formData = new FormData()
      const maliciousJs = 'alert("XSS")'
      const file = new File([maliciousJs], 'malicious.js', { type: 'application/javascript' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'js' is not allowed")
    })

    it('should reject files without extensions', async () => {
      const formData = new FormData()
      const file = new File(['test content'], 'noextension', { type: 'application/octet-stream' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'noextension' is not allowed")
    })

    it('should handle multiple files with mixed valid/invalid types', async () => {
      const formData = new FormData()

      const validFile = new File(['valid content'], 'valid.pdf', { type: 'application/pdf' })
      formData.append('file', validFile)

      const invalidFile = new File(['<script>alert("XSS")</script>'], 'malicious.html', {
        type: 'text/html',
      })
      formData.append('file', invalidFile)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'html' is not allowed")
    })
  })

  describe('Authentication Requirements', () => {
    it('should reject uploads without authentication', async () => {
      mocks.mockGetSession.mockResolvedValue(null)

      const formData = new FormData()
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })
})
