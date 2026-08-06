/**
 * @vitest-environment node
 */
import { authMockFns, storageServiceMock, storageServiceMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyUploadToken } = vi.hoisted(() => ({
  mockVerifyUploadToken: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/core/upload-token', () => ({
  verifyUploadToken: mockVerifyUploadToken,
}))

import { POST } from '@/app/api/files/presigned/verify/route'

const request = () =>
  new NextRequest('http://localhost/api/files/presigned/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadToken: 'signed-token' }),
  })

describe('POST /api/files/presigned/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyUploadToken.mockReturnValue({
      valid: true,
      payload: {
        uploadId: 'receipt-1',
        key: 'knowledge-base/unique-file.pdf',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        context: 'knowledge-base',
        uploadKind: 'direct',
      },
    })
    storageServiceMockFns.mockVerifyPresignedUploadReceipt.mockResolvedValue(true)
  })

  it('verifies the signed key and receipt against object metadata', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ uploaded: true })
    expect(storageServiceMockFns.mockVerifyPresignedUploadReceipt).toHaveBeenCalledWith({
      key: 'knowledge-base/unique-file.pdf',
      context: 'knowledge-base',
      uploadId: 'receipt-1',
    })
  })

  it('does not treat a multipart or user-mismatched token as a direct-upload receipt', async () => {
    mockVerifyUploadToken.mockReturnValueOnce({
      valid: true,
      payload: {
        uploadId: 'upload-1',
        key: 'knowledge-base/file.pdf',
        userId: 'different-user',
        workspaceId: 'workspace-1',
        context: 'knowledge-base',
      },
    })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(storageServiceMockFns.mockVerifyPresignedUploadReceipt).not.toHaveBeenCalled()
  })
})
