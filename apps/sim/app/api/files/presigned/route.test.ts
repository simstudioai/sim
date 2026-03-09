/**
 * Tests for file presigned API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockVerifyFileAccess,
  mockVerifyWorkspaceFileAccess,
  mockUseBlobStorage,
  mockUseS3Storage,
  mockGetStorageConfig,
  mockIsUsingCloudStorage,
  mockGetStorageProvider,
  mockHasCloudStorage,
  mockGeneratePresignedUploadUrl,
  mockGeneratePresignedDownloadUrl,
  mockValidateFileType,
  mockGenerateCopilotUploadUrl,
  mockIsImageFileType,
  mockGetStorageProviderUploads,
  mockIsUsingCloudStorageUploads,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyFileAccess: vi.fn().mockResolvedValue(true),
  mockVerifyWorkspaceFileAccess: vi.fn().mockResolvedValue(true),
  mockUseBlobStorage: { value: false },
  mockUseS3Storage: { value: true },
  mockGetStorageConfig: vi.fn(),
  mockIsUsingCloudStorage: vi.fn(),
  mockGetStorageProvider: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockGeneratePresignedUploadUrl: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn().mockResolvedValue('https://example.com/presigned-url'),
  mockValidateFileType: vi.fn().mockReturnValue(null),
  mockGenerateCopilotUploadUrl: vi.fn().mockResolvedValue({
    url: 'https://example.com/presigned-url',
    key: 'copilot/test-key.txt',
  }),
  mockIsImageFileType: vi.fn().mockReturnValue(true),
  mockGetStorageProviderUploads: vi.fn(),
  mockIsUsingCloudStorageUploads: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
  verifyWorkspaceFileAccess: mockVerifyWorkspaceFileAccess,
}))

vi.mock('@/lib/uploads/config', () => ({
  get USE_BLOB_STORAGE() {
    return mockUseBlobStorage.value
  },
  get USE_S3_STORAGE() {
    return mockUseS3Storage.value
  },
  UPLOAD_DIR: '/uploads',
  getStorageConfig: mockGetStorageConfig,
  isUsingCloudStorage: mockIsUsingCloudStorage,
  getStorageProvider: mockGetStorageProvider,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mockHasCloudStorage,
  generatePresignedUploadUrl: mockGeneratePresignedUploadUrl,
  generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({
  validateFileType: mockValidateFileType,
}))

vi.mock('@/lib/uploads', () => ({
  CopilotFiles: {
    generateCopilotUploadUrl: mockGenerateCopilotUploadUrl,
    isImageFileType: mockIsImageFileType,
  },
  getStorageProvider: mockGetStorageProviderUploads,
  isUsingCloudStorage: mockIsUsingCloudStorageUploads,
}))

import { OPTIONS, POST } from '@/app/api/files/presigned/route'

const defaultMockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
}

function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  if (authenticated) {
    mockGetSession.mockResolvedValue({ user: defaultMockUser })
  } else {
    mockGetSession.mockResolvedValue(null)
  }

  const useBlobStorage = storageProvider === 'blob' && cloudEnabled
  const useS3Storage = storageProvider === 's3' && cloudEnabled

  mockUseBlobStorage.value = useBlobStorage
  mockUseS3Storage.value = useS3Storage

  mockGetStorageConfig.mockReturnValue(
    useBlobStorage
      ? {
          accountName: 'testaccount',
          accountKey: 'testkey',
          connectionString: 'testconnection',
          containerName: 'testcontainer',
        }
      : {
          bucket: 'test-bucket',
          region: 'us-east-1',
        }
  )
  mockIsUsingCloudStorage.mockReturnValue(cloudEnabled)
  mockGetStorageProvider.mockReturnValue(
    storageProvider === 'blob' ? 'Azure Blob' : storageProvider === 's3' ? 'S3' : 'Local'
  )

  mockHasCloudStorage.mockReturnValue(cloudEnabled)
  mockGeneratePresignedUploadUrl.mockImplementation(
    async (opts: { fileName: string; context: string }) => {
      const timestamp = Date.now()
      const safeFileName = opts.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      const key = `${opts.context}/${timestamp}-ik3a6w4-${safeFileName}`
      return {
        url: 'https://example.com/presigned-url',
        key,
      }
    }
  )
  mockGeneratePresignedDownloadUrl.mockResolvedValue('https://example.com/presigned-url')

  mockValidateFileType.mockReturnValue(null)

  mockGetStorageProviderUploads.mockReturnValue(
    storageProvider === 'blob' ? 'Azure Blob' : storageProvider === 's3' ? 'S3' : 'Local'
  )
  mockIsUsingCloudStorageUploads.mockReturnValue(cloudEnabled)
}

describe('/api/files/presigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('POST', () => {
    it('should return graceful fallback response when cloud storage is not enabled', async () => {
      setupFileApiMocks({
        cloudEnabled: false,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.directUploadSupported).toBe(false)
      expect(data.presignedUrl).toBe('')
      expect(data.fileName).toBe('test.txt')
      expect(data.fileInfo).toBeDefined()
      expect(data.fileInfo.name).toBe('test.txt')
      expect(data.fileInfo.size).toBe(1024)
      expect(data.fileInfo.type).toBe('text/plain')
    })

    it('should return error when fileName is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('fileName is required and cannot be empty')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when contentType is missing', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('contentType is required and cannot be empty')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when fileSize is invalid', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 0,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('fileSize must be a positive number')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should return error when file size exceeds limit', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const largeFileSize = 150 * 1024 * 1024 // 150MB (exceeds 100MB limit)
      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'large-file.txt',
          contentType: 'text/plain',
          fileSize: largeFileSize,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('exceeds maximum allowed size')
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('should generate S3 presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test document.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.presignedUrl).toBe('https://example.com/presigned-url')
      expect(data.fileInfo).toMatchObject({
        path: expect.stringMatching(/\/api\/files\/serve\/s3\/.+\?context=chat$/),
        key: expect.stringMatching(/.*test.document\.txt$/),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate knowledge-base S3 presigned URL with kb prefix', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest(
        'http://localhost:3000/api/files/presigned?type=knowledge-base',
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: 'knowledge-doc.pdf',
            contentType: 'application/pdf',
            fileSize: 2048,
          }),
        }
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^knowledge-base\/.*knowledge-doc\.pdf$/)
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate chat S3 presigned URL with chat prefix and direct path', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'chat-logo.png',
          contentType: 'image/png',
          fileSize: 4096,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^chat\/.*chat-logo\.png$/)
      expect(data.fileInfo.path).toMatch(/\/api\/files\/serve\/s3\/.+\?context=chat$/)
      expect(data.presignedUrl).toBeTruthy()
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate Azure Blob presigned URL successfully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test document.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.presignedUrl).toBeTruthy()
      expect(typeof data.presignedUrl).toBe('string')
      expect(data.fileInfo).toMatchObject({
        key: expect.stringMatching(/.*test.document\.txt$/),
        name: 'test document.txt',
        size: 1024,
        type: 'text/plain',
      })
      expect(data.directUploadSupported).toBe(true)
    })

    it('should generate chat Azure Blob presigned URL with chat prefix and direct path', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'chat-logo.png',
          contentType: 'image/png',
          fileSize: 4096,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.fileInfo.key).toMatch(/^chat\/.*chat-logo\.png$/)
      expect(data.fileInfo.path).toMatch(/\/api\/files\/serve\/blob\/.+\?context=chat$/)
      expect(data.presignedUrl).toBeTruthy()
      expect(data.directUploadSupported).toBe(true)
    })

    it('should return error for unknown storage provider', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      mockGeneratePresignedUploadUrl.mockRejectedValue(
        new Error('Unknown storage provider: unknown')
      )

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle S3 errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      mockGeneratePresignedUploadUrl.mockRejectedValue(new Error('S3 service unavailable'))

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle Azure Blob errors gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 'blob',
      })

      mockGeneratePresignedUploadUrl.mockRejectedValue(new Error('Azure service unavailable'))

      const request = new NextRequest('http://localhost:3000/api/files/presigned?type=chat', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBeTruthy()
      expect(typeof data.error).toBe('string')
    })

    it('should handle malformed JSON gracefully', async () => {
      setupFileApiMocks({
        cloudEnabled: true,
        storageProvider: 's3',
      })

      const request = new NextRequest('http://localhost:3000/api/files/presigned', {
        method: 'POST',
        body: 'invalid json',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400) // Changed from 500 to 400 (ValidationError)
      expect(data.error).toBe('Invalid JSON in request body') // Updated error message
      expect(data.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('OPTIONS', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await OPTIONS()

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization'
      )
    })
  })
})
