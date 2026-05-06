/**
 * @vitest-environment node
 */
import {
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckStorageQuota, mockGenerateWorkspaceFileKey, mockUseBlobStorage } = vi.hoisted(
  () => ({
    mockCheckStorageQuota: vi.fn(),
    mockGenerateWorkspaceFileKey: vi.fn(),
    mockUseBlobStorage: { value: false },
  })
)

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  generateWorkspaceFileKey: mockGenerateWorkspaceFileKey,
}))

vi.mock('@/lib/uploads/config', () => ({
  get USE_BLOB_STORAGE() {
    return mockUseBlobStorage.value
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'

import { POST } from '@/app/api/workspaces/[id]/files/presigned/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

const makeRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/presigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const validBody = {
  fileName: 'video.mp4',
  contentType: 'video/mp4',
  fileSize: 10 * 1024 * 1024,
}

describe('POST /api/workspaces/[id]/files/presigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockCheckStorageQuota.mockResolvedValue({ allowed: true })
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    mockGenerateWorkspaceFileKey.mockReturnValue(`workspace/${WS}/123-abc-video.mp4`)
    storageServiceMockFns.mockGeneratePresignedUploadUrl.mockResolvedValue({
      url: 'https://s3/presigned',
      key: `workspace/${WS}/123-abc-video.mp4`,
      uploadHeaders: { 'Content-Type': 'video/mp4' },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has read-only permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing fileName', async () => {
    const res = await POST(makeRequest({ ...validBody, fileName: '' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 for negative fileSize', async () => {
    const res = await POST(makeRequest({ ...validBody, fileSize: -1 }), params())
    expect(res.status).toBe(400)
  })

  it('accepts fileSize === 0 (empty new files)', async () => {
    const res = await POST(makeRequest({ ...validBody, fileSize: 0 }), params())
    expect(res.status).toBe(200)
  })

  it('returns 413 when fileSize exceeds 5 GiB ceiling', async () => {
    const res = await POST(
      makeRequest({ ...validBody, fileSize: 6 * 1024 * 1024 * 1024 }),
      params()
    )
    expect(res.status).toBe(413)
  })

  it('returns 413 when storage quota would be exceeded', async () => {
    mockCheckStorageQuota.mockResolvedValueOnce({ allowed: false, error: 'Over quota' })
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(413)
    expect(body.error).toBe('Over quota')
  })

  it('returns local fallback signal when cloud storage is not configured', async () => {
    storageServiceMockFns.mockHasCloudStorage.mockReturnValueOnce(false)
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.directUploadSupported).toBe(false)
    expect(body.presignedUrl).toBe('')
    expect(body.fileInfo.name).toBe('video.mp4')
    expect(storageServiceMockFns.mockGeneratePresignedUploadUrl).not.toHaveBeenCalled()
  })

  it('issues a presigned URL bound to the workspace', async () => {
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.directUploadSupported).toBe(true)
    expect(body.presignedUrl).toBe('https://s3/presigned')
    expect(body.fileInfo.key).toBe(`workspace/${WS}/123-abc-video.mp4`)
    expect(body.fileInfo.path).toContain('?context=workspace')
    expect(body.fileInfo.path).toContain('s3')
    expect(body.uploadHeaders).toEqual({ 'Content-Type': 'video/mp4' })

    expect(mockGenerateWorkspaceFileKey).toHaveBeenCalledWith(WS, 'video.mp4')
    expect(storageServiceMockFns.mockGeneratePresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'workspace',
        userId: 'user-1',
        customKey: `workspace/${WS}/123-abc-video.mp4`,
        metadata: { workspaceId: WS },
      })
    )
  })

  it('serves blob path when blob storage is configured', async () => {
    mockUseBlobStorage.value = true
    try {
      const res = await POST(makeRequest(validBody), params())
      const body = await res.json()
      expect(body.fileInfo.path).toContain('/blob/')
    } finally {
      mockUseBlobStorage.value = false
    }
  })
})
