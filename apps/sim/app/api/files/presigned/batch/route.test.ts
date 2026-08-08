/**
 * Tests for the batch presigned upload API route
 *
 * @vitest-environment node
 */

import { authMockFns, storageServiceMock, storageServiceMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockValidateFileType,
  mockGetUserEntityPermissions,
  mockRecordKnowledgeBaseFileOwnershipMany,
  mockSignUploadToken,
} = vi.hoisted(() => ({
  mockValidateFileType: vi.fn().mockReturnValue(null),
  mockGetUserEntityPermissions: vi.fn().mockResolvedValue('write'),
  mockRecordKnowledgeBaseFileOwnershipMany: vi.fn().mockResolvedValue(undefined),
  mockSignUploadToken: vi.fn(),
}))

vi.mock('@/lib/uploads/config', () => ({
  getServeStoragePrefix: () => 's3',
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/core/upload-token', () => ({
  signUploadToken: mockSignUploadToken,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({
  validateFileType: mockValidateFileType,
  SUPPORTED_ARCHIVE_EXTENSIONS: ['zip'] as const,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  recordKnowledgeBaseFileOwnershipMany: mockRecordKnowledgeBaseFileOwnershipMany,
}))

import { POST } from '@/app/api/files/presigned/batch/route'

const KB_QUERY = 'type=knowledge-base&workspaceId=ws-1'

const buildRequest = (query: string, files?: unknown) =>
  new NextRequest(`http://localhost:3000/api/files/presigned/batch?${query}`, {
    method: 'POST',
    body: JSON.stringify({
      files: files ?? [{ fileName: 'doc.pdf', contentType: 'application/pdf', fileSize: 1024 }],
    }),
  })

describe('/api/files/presigned/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockValidateFileType.mockReturnValue(null)
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockRecordKnowledgeBaseFileOwnershipMany.mockResolvedValue(undefined)
    mockSignUploadToken.mockReturnValue('signed-receipt-token')
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    storageServiceMockFns.mockGenerateBatchPresignedUploadUrls.mockImplementation(
      async (files: Array<{ fileName: string }>, context: string) =>
        files.map((file) => ({
          url: `https://example.com/${context}/${file.fileName}`,
          key: `${context}/${file.fileName}`,
          uploadId: `receipt-${file.fileName}`,
        }))
    )
  })

  it('returns 401 when the caller has no session', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await POST(buildRequest(KB_QUERY))

    expect(response.status).toBe(401)
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })

  it.each([
    'workspace-logos',
    'profile-pictures',
    'execution',
    'mothership',
    'chat',
    'copilot',
    'workspace',
  ])('refuses to presign the %s context', async (type) => {
    const response = await POST(buildRequest(`type=${type}&workspaceId=ws-1`))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Invalid type parameter')
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })

  it('returns 400 when type is missing', async () => {
    const response = await POST(buildRequest('workspaceId=ws-1'))

    expect(response.status).toBe(400)
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceId is missing', async () => {
    const response = await POST(buildRequest('type=knowledge-base'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('workspaceId')
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })

  it.each([['read'], [null]])(
    'returns 403 when the caller has %s access to the workspace',
    async (permission) => {
      mockGetUserEntityPermissions.mockResolvedValue(permission)

      const response = await POST(buildRequest(KB_QUERY))

      expect(response.status).toBe(403)
      expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
    }
  )

  it('authorizes the workspace before returning the local-storage fallback', async () => {
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(false)
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await POST(buildRequest(KB_QUERY))

    expect(response.status).toBe(403)
  })

  it('rejects unsupported file types before minting any URL', async () => {
    mockValidateFileType.mockReturnValue({
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Unsupported file type: html.',
      supportedTypes: ['pdf'],
    })

    const response = await POST(
      buildRequest(KB_QUERY, [{ fileName: 'poc.html', contentType: 'text/html', fileSize: 41 }])
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })

  it('mints knowledge-base URLs and records workspace ownership for a permitted caller', async () => {
    const response = await POST(buildRequest(KB_QUERY))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'ws-1')
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).toHaveBeenCalledWith(
      [{ fileName: 'doc.pdf', contentType: 'application/pdf', fileSize: 1024 }],
      'knowledge-base',
      'user-1',
      3600
    )
    expect(data.files).toHaveLength(1)
    expect(data.files[0].fileInfo.key).toBe('knowledge-base/doc.pdf')
    expect(data.files[0].fileInfo.path).toContain('?context=knowledge-base')
    expect(data.files[0].uploadToken).toBe('signed-receipt-token')
    expect(mockSignUploadToken).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: 'receipt-doc.pdf',
        key: 'knowledge-base/doc.pdf',
        userId: 'user-1',
        workspaceId: 'ws-1',
        context: 'knowledge-base',
        uploadKind: 'direct',
      })
    )
    expect(data.directUploadSupported).toBe(true)
    expect(mockRecordKnowledgeBaseFileOwnershipMany).toHaveBeenCalledWith([
      {
        key: 'knowledge-base/doc.pdf',
        userId: 'user-1',
        workspaceId: 'ws-1',
        originalName: 'doc.pdf',
        contentType: 'application/pdf',
        size: 1024,
      },
    ])
  })

  it('returns the fallback response when cloud storage is not configured', async () => {
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(false)

    const response = await POST(buildRequest(KB_QUERY))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.directUploadSupported).toBe(false)
    expect(data.files[0].presignedUrl).toBe('')
    expect(storageServiceMockFns.mockGenerateBatchPresignedUploadUrls).not.toHaveBeenCalled()
  })
})
