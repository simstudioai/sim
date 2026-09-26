import {
  authMockFns,
  hybridAuthMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/utils/id', () => idMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}))

import { createMockRequest } from '@sim/testing'
import { POST } from '@/app/api/files/delete/route'

idMockFns.mockGenerateId.mockReturnValue('test-uuid')
idMockFns.mockGenerateShortId.mockReturnValue('mock-short-id')
uploadsMetadataMockFns.mockDeleteFileMetadata.mockResolvedValue(undefined)

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
    filesAuthorizationMockFns.mockVerifyFileAccess.mockResolvedValue(true)
    storageServiceMockFns.mockDeleteFile.mockResolvedValue(undefined)
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    uploadsMockFns.mockGetStorageProvider.mockReturnValue('s3')
    uploadsMockFns.mockIsUsingCloudStorage.mockReturnValue(true)
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
    expect(filesAuthorizationMockFns.mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })
})
