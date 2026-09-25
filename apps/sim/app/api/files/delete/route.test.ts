import {
  authMockFns,
  hybridAuthMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockVerifyFileAccess = vi.fn()
  const mockVerifyWorkspaceFileAccess = vi.fn()
  const mockGetStorageProvider = vi.fn()
  const mockIsUsingCloudStorage = vi.fn()

  return {
    mockVerifyFileAccess,
    mockVerifyWorkspaceFileAccess,
    mockGetStorageProvider,
    mockIsUsingCloudStorage,
  }
})

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'test-uuid'),
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mocks.mockVerifyFileAccess,
  verifyWorkspaceFileAccess: mocks.mockVerifyWorkspaceFileAccess,
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: mocks.mockGetStorageProvider,
  isUsingCloudStorage: mocks.mockIsUsingCloudStorage,
  StorageService: {
    uploadFile: storageServiceMockFns.mockUploadFile,
    downloadFile: storageServiceMockFns.mockDownloadFile,
    deleteFile: storageServiceMockFns.mockDeleteFile,
    hasCloudStorage: storageServiceMockFns.mockHasCloudStorage,
  },
  uploadFile: storageServiceMockFns.mockUploadFile,
  downloadFile: storageServiceMockFns.mockDownloadFile,
  deleteFile: storageServiceMockFns.mockDeleteFile,
  hasCloudStorage: storageServiceMockFns.mockHasCloudStorage,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}))

import { createMockRequest } from '@sim/testing'
import { POST } from '@/app/api/files/delete/route'

describe('File Delete API Route', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })

    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'test-user-id' } })
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'test-user-id',
      error: undefined,
    })
    mocks.mockVerifyFileAccess.mockResolvedValue(true)
    mocks.mockVerifyWorkspaceFileAccess.mockResolvedValue(true)
    storageServiceMockFns.mockDeleteFile.mockResolvedValue(undefined)
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    mocks.mockGetStorageProvider.mockReturnValue('s3')
    mocks.mockIsUsingCloudStorage.mockReturnValue(true)
  })

  it('rejects a client context that disagrees with the key prefix', async () => {
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/workspace/victim-ws/1234-report.pdf',
      context: 'og-images',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(mocks.mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })
})
