/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuotaForBillingContext,
  mockInitiateMultipartProviderUpload,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockInitiateMultipartProviderUpload: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({ headObject: vi.fn() }))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  generateWorkspaceFileKey: vi.fn(
    (workspaceId: string, fileName: string) => `workspace/${workspaceId}/${fileName}`
  ),
}))

vi.mock('@/lib/uploads/multipart-session/provider', () => ({
  abortMultipartProviderUpload: vi.fn(),
  completeMultipartProviderUpload: vi.fn(),
  getMultipartProviderPartUrls: vi.fn(),
  initiateMultipartProviderUpload: mockInitiateMultipartProviderUpload,
}))

import {
  createUploadSession,
  getOwnedUploadSession,
  verifyUploadSessionToken,
} from '@/lib/uploads/multipart-session/service'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('knowledge-document multipart sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveStorageBillingContext.mockResolvedValue({ workspaceId: WORKSPACE_ID })
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockInitiateMultipartProviderUpload.mockResolvedValue({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
    })
  })

  it('binds knowledge ownership and all storage state into the signed token', async () => {
    const created = await createUploadSession({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      purpose: 'knowledge_document',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    })

    const verified = verifyUploadSessionToken(created.uploadToken)
    expect(verified).toMatchObject({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      purpose: 'knowledge_document',
      storageContext: 'knowledge-base',
      storageProvider: 's3',
      providerUploadId: 'provider-upload-1',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    })
    expect(verified.storageKey).toMatch(/^kb\/.*-guide\.pdf$/)
  })

  it.each([
    { userId: 'other-user', knowledgeBaseId: 'kb-1', purpose: 'knowledge_document' as const },
    { userId: 'user-1', knowledgeBaseId: 'kb-2', purpose: 'knowledge_document' as const },
    { userId: 'user-1', knowledgeBaseId: 'kb-1', purpose: 'workspace_file' as const },
  ])('rejects a session whose signed scope does not match $purpose', async (scope) => {
    const created = await createUploadSession({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      purpose: 'knowledge_document',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    })

    expect(() =>
      getOwnedUploadSession({
        uploadId: 'upload-1',
        workspaceId: WORKSPACE_ID,
        uploadToken: created.uploadToken,
        ...scope,
      })
    ).toThrow('Upload session not found')
  })

  it('runs the storage quota gate before creating provider state', async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: false,
      error: 'Storage limit exceeded',
    })

    await expect(
      createUploadSession({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        knowledgeBaseId: 'kb-1',
        purpose: 'knowledge_document',
        fileName: 'guide.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mockInitiateMultipartProviderUpload).not.toHaveBeenCalled()
  })
})
