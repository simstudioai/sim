/**
 * @vitest-environment node
 */
import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsUsingCloudStorage,
  mockGetStorageProvider,
  mockGetStorageConfig,
  mockCompleteS3MultipartUpload,
  mockCompleteBlobMultipartUpload,
  mockDeriveBlobBlockId,
  mockVerifyUploadToken,
  mockSignUploadToken,
} = vi.hoisted(() => ({
  mockIsUsingCloudStorage: vi.fn(),
  mockGetStorageProvider: vi.fn(),
  mockGetStorageConfig: vi.fn(),
  mockCompleteS3MultipartUpload: vi.fn(),
  mockCompleteBlobMultipartUpload: vi.fn(),
  mockDeriveBlobBlockId: vi.fn(),
  mockVerifyUploadToken: vi.fn(),
  mockSignUploadToken: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: mockIsUsingCloudStorage,
  getStorageProvider: mockGetStorageProvider,
  getStorageConfig: mockGetStorageConfig,
}))

vi.mock('@/lib/uploads/core/upload-token', () => ({
  signUploadToken: mockSignUploadToken,
  verifyUploadToken: mockVerifyUploadToken,
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  completeS3MultipartUpload: mockCompleteS3MultipartUpload,
  initiateS3MultipartUpload: vi.fn(),
  getS3MultipartPartUrls: vi.fn(),
  abortS3MultipartUpload: vi.fn(),
}))

vi.mock('@/lib/uploads/providers/blob/client', () => ({
  completeMultipartUpload: mockCompleteBlobMultipartUpload,
  deriveBlobBlockId: mockDeriveBlobBlockId,
  initiateMultipartUpload: vi.fn(),
  getMultipartPartUrls: vi.fn(),
  abortMultipartUpload: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/files/multipart/route'

const tokenPayload = {
  uploadId: 'upload-1',
  key: 'workspace/ws-1/123-abc-file.bin',
  userId: 'user-1',
  workspaceId: 'ws-1',
  context: 'workspace' as const,
}

const makeRequest = (action: string, body: unknown) =>
  new NextRequest(`http://localhost/api/files/multipart?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/files/multipart action=complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockGetStorageConfig.mockReturnValue({ bucket: 'b', region: 'r' })
    mockVerifyUploadToken.mockReturnValue({ valid: true, payload: tokenPayload })
    mockSignUploadToken.mockReturnValue('signed-token')
    mockCompleteS3MultipartUpload.mockResolvedValue({
      location: 'loc',
      path: '/api/files/serve/...',
      key: tokenPayload.key,
    })
    mockCompleteBlobMultipartUpload.mockResolvedValue({
      location: 'loc',
      path: '/api/files/serve/...',
      key: tokenPayload.key,
    })
    mockDeriveBlobBlockId.mockImplementation(
      (n: number) => `block-${n.toString().padStart(6, '0')}`
    )
  })

  it('rejects parts without partNumber', async () => {
    mockGetStorageProvider.mockReturnValue('s3')
    const res = await POST(
      makeRequest('complete', {
        uploadToken: 'tok',
        parts: [{ etag: 'abc' }],
      })
    )
    expect(res.status).toBe(400)
    expect(mockCompleteS3MultipartUpload).not.toHaveBeenCalled()
  })

  it('S3 path requires etag and forwards { ETag, PartNumber }', async () => {
    mockGetStorageProvider.mockReturnValue('s3')

    const missingEtag = await POST(
      makeRequest('complete', {
        uploadToken: 'tok',
        parts: [{ partNumber: 1 }],
      })
    )
    expect(missingEtag.status).toBe(500)

    mockCompleteS3MultipartUpload.mockClear()

    const ok = await POST(
      makeRequest('complete', {
        uploadToken: 'tok',
        parts: [
          { partNumber: 1, etag: 'aaa' },
          { partNumber: 2, etag: 'bbb' },
        ],
      })
    )
    expect(ok.status).toBe(200)
    expect(mockCompleteS3MultipartUpload).toHaveBeenCalledWith(
      tokenPayload.key,
      tokenPayload.uploadId,
      [
        { ETag: 'aaa', PartNumber: 1 },
        { ETag: 'bbb', PartNumber: 2 },
      ],
      expect.any(Object)
    )
  })

  it('Blob path derives blockId from partNumber and ignores etag', async () => {
    mockGetStorageProvider.mockReturnValue('blob')
    mockGetStorageConfig.mockReturnValue({
      containerName: 'c',
      accountName: 'a',
      accountKey: 'k',
    })

    const res = await POST(
      makeRequest('complete', {
        uploadToken: 'tok',
        parts: [{ partNumber: 1, etag: 'irrelevant' }, { partNumber: 2 }],
      })
    )

    expect(res.status).toBe(200)
    expect(mockDeriveBlobBlockId).toHaveBeenCalledWith(1)
    expect(mockDeriveBlobBlockId).toHaveBeenCalledWith(2)
    expect(mockCompleteBlobMultipartUpload).toHaveBeenCalledWith(
      tokenPayload.key,
      [
        { partNumber: 1, blockId: 'block-000001' },
        { partNumber: 2, blockId: 'block-000002' },
      ],
      expect.objectContaining({ containerName: 'c' })
    )
  })

  it('returns 403 when token is invalid', async () => {
    mockGetStorageProvider.mockReturnValue('s3')
    mockVerifyUploadToken.mockReturnValueOnce({ valid: false })
    const res = await POST(
      makeRequest('complete', {
        uploadToken: 'bad',
        parts: [{ partNumber: 1, etag: 'a' }],
      })
    )
    expect(res.status).toBe(403)
  })

  it('batch complete normalizes per upload', async () => {
    mockGetStorageProvider.mockReturnValue('s3')
    const res = await POST(
      makeRequest('complete', {
        uploads: [
          {
            uploadToken: 'tok-a',
            parts: [{ partNumber: 1, etag: 'aaa' }],
          },
          {
            uploadToken: 'tok-b',
            parts: [{ partNumber: 1, etag: 'bbb' }],
          },
        ],
      })
    )
    expect(res.status).toBe(200)
    expect(mockCompleteS3MultipartUpload).toHaveBeenCalledTimes(2)
  })
})
