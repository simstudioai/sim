/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuota,
  mockCompleteMultipart,
  mockCreatePutTransfer,
  mockDeleteObjectVersion,
  mockHeadObject,
  mockInitiateMultipart,
  mockPromoteObject,
  mockResolveBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuota: vi.fn(),
  mockCompleteMultipart: vi.fn(),
  mockCreatePutTransfer: vi.fn(),
  mockDeleteObjectVersion: vi.fn(),
  mockHeadObject: vi.fn(),
  mockInitiateMultipart: vi.fn(),
  mockPromoteObject: vi.fn(),
  mockResolveBillingContext: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuota,
  resolveStorageBillingContext: mockResolveBillingContext,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  generateWorkspaceFileKey: vi.fn(
    (workspaceId: string, fileName: string) => `workspace/${workspaceId}/final-${fileName}`
  ),
}))

vi.mock('@/lib/uploads/upload-session/cleanup', () => ({
  maybeCleanupLocalUploadArtifacts: vi.fn().mockResolvedValue({ scanned: 0, removed: 0 }),
}))

vi.mock('@/lib/uploads/upload-session/provider', () => ({
  abortProviderUpload: vi.fn(),
  completeMultipartProviderUpload: mockCompleteMultipart,
  createPutProviderTransfer: mockCreatePutTransfer,
  deleteProviderObjectVersion: mockDeleteObjectVersion,
  getMultipartProviderPartUrls: vi.fn(),
  headProviderObject: mockHeadObject,
  initiateMultipartProviderUpload: mockInitiateMultipart,
  promoteProviderObject: mockPromoteObject,
  uploadStorageProvider: vi.fn(() => 's3'),
}))

import {
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import {
  completeUploadSession,
  createUploadSession,
  UPLOAD_SESSION_PUT_MAX_BYTES,
  validateUploadCompletion,
  verifyUploadSessionToken,
} from '@/lib/uploads/upload-session/service'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('upload sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveBillingContext.mockResolvedValue({ workspaceId: WORKSPACE_ID })
    mockCheckStorageQuota.mockResolvedValue({ allowed: true })
    mockCreatePutTransfer.mockResolvedValue({
      method: 'put',
      url: 'https://storage.example/upload',
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    mockInitiateMultipart.mockResolvedValue({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
    })
  })

  it('selects PUT at exactly 50 MiB', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES)

    expect(created.transfer.method).toBe('put')
    expect(created.method).toBe('put')
    expect(created.partSize).toBeNull()
    expect(created.partCount).toBeNull()
    expect(mockInitiateMultipart).not.toHaveBeenCalled()
  })

  it('selects multipart at 50 MiB plus one byte', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)

    expect(created.transfer).toMatchObject({ method: 'multipart', partCount: 7 })
    expect(created.method).toBe('multipart')
    expect(mockInitiateMultipart).toHaveBeenCalledOnce()
  })

  it('binds purpose scope, staging, destination, method, and identity into the token', async () => {
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

    expect(verifyUploadSessionToken(created.uploadToken)).toMatchObject({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      purpose: 'knowledge_document',
      method: 'put',
      storageContext: 'knowledge-base',
      storageProvider: 's3',
      stagingKey: 'upload-sessions/upload-1/guide.pdf',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    })
  })

  it('quota-gates durable files while exempting retention-scoped attachments', async () => {
    await createWorkspaceUpload(1024)
    expect(mockResolveBillingContext).toHaveBeenCalledOnce()
    expect(mockCheckStorageQuota).toHaveBeenCalledOnce()

    await createUploadSession({
      id: 'execution-upload',
      workspaceId: WORKSPACE_ID,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      userId: 'user-1',
      purpose: 'execution_attachment',
      fileName: 'result.txt',
      contentType: 'text/plain',
      fileSize: 1024,
    })
    expect(mockResolveBillingContext).toHaveBeenCalledOnce()
    expect(mockCheckStorageQuota).toHaveBeenCalledOnce()

    await createUploadSession({
      id: 'mothership-upload',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      purpose: 'mothership_attachment',
      fileName: 'prompt.txt',
      contentType: 'text/plain',
      fileSize: 1024,
    })
    expect(mockResolveBillingContext).toHaveBeenCalledOnce()
    expect(mockCheckStorageQuota).toHaveBeenCalledOnce()
  })

  it('preserves the 5 GiB mothership limit while bounding execution attachments at 100 MiB', async () => {
    await expect(
      createUploadSession({
        id: 'mothership-upload',
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        purpose: 'mothership_attachment',
        fileName: 'archive.zip',
        contentType: 'application/zip',
        fileSize: MAX_WORKSPACE_FILE_SIZE,
      })
    ).resolves.toMatchObject({
      method: 'multipart',
      transfer: { method: 'multipart', partCount: 640 },
    })

    await expect(
      createUploadSession({
        id: 'oversized-mothership-upload',
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        purpose: 'mothership_attachment',
        fileName: 'archive.zip',
        contentType: 'application/zip',
        fileSize: MAX_WORKSPACE_FILE_SIZE + 1,
      })
    ).rejects.toThrow(`File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes`)

    await expect(
      createUploadSession({
        id: 'execution-upload',
        workspaceId: WORKSPACE_ID,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
        purpose: 'execution_attachment',
        fileName: 'result.txt',
        contentType: 'text/plain',
        fileSize: MAX_WORKSPACE_FORMDATA_FILE_SIZE + 1,
      })
    ).rejects.toThrow(`File size exceeds maximum of ${MAX_WORKSPACE_FORMDATA_FILE_SIZE} bytes`)
  })

  it('validates PUT completion input independently of finalization', async () => {
    const created = await createWorkspaceUpload(1024)

    expect(validateUploadCompletion(created, {})).toEqual([])
    expect(() => validateUploadCompletion(created, { parts: [] })).toThrow(
      'PUT completion must not include parts'
    )
  })

  it('requires every multipart part and cloud ETag before finalization or replay', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    const parts = Array.from({ length: created.partCount ?? 0 }, (_, index) => ({
      partNumber: index + 1,
      etag: `etag-${index + 1}`,
    }))

    expect(validateUploadCompletion(created, { parts })).toBe(parts)
    expect(() => validateUploadCompletion(created, {})).toThrow(
      'Multipart completion requires parts'
    )
    expect(() =>
      validateUploadCompletion(created, { parts: parts.map(({ partNumber }) => ({ partNumber })) })
    ).toThrow('etag is required for s3 part 1')
  })

  it('resumes after multipart assembly without consuming the provider upload twice', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    const identity = objectIdentity(created.id, created.fileSize, created.contentType)
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)

    await expect(
      completeUploadSession({
        session: created,
        completion: { parts: completedParts(created.partCount) },
        finalize: async () => ({ value: 'file-1', completedFileId: 'file-1' }),
      })
    ).resolves.toMatchObject({ value: 'file-1', alreadyCompleted: false })

    expect(mockCompleteMultipart).not.toHaveBeenCalled()
    expect(mockPromoteObject).toHaveBeenCalledOnce()
  })

  it('completes multipart at staging when no assembled object exists yet', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    const identity = objectIdentity(created.id, created.fileSize, created.contentType)
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)

    await completeUploadSession({
      session: created,
      completion: { parts: completedParts(created.partCount) },
      finalize: async () => ({ value: 'file-1' }),
    })

    expect(mockCompleteMultipart).toHaveBeenCalledOnce()
    expect(mockCompleteMultipart).toHaveBeenCalledWith(
      expect.objectContaining({ stagingKey: created.stagingKey })
    )
  })

  it('recovers when another completion consumes the provider upload concurrently', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    const identity = objectIdentity(created.id, created.fileSize, created.contentType)
    mockCompleteMultipart.mockRejectedValueOnce(new Error('NoSuchUpload'))
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)

    await expect(
      completeUploadSession({
        session: created,
        completion: { parts: completedParts(created.partCount) },
        finalize: async () => ({ value: 'file-1' }),
      })
    ).resolves.toMatchObject({ value: 'file-1', alreadyCompleted: false })

    expect(mockCompleteMultipart).toHaveBeenCalledOnce()
    expect(mockPromoteObject).toHaveBeenCalledOnce()
  })

  it('preserves the provider completion error when no staged object was created', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    mockCompleteMultipart.mockRejectedValueOnce(new Error('NoSuchUpload'))
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    await expect(
      completeUploadSession({
        session: created,
        completion: { parts: completedParts(created.partCount) },
        finalize: async () => ({ value: 'file-1' }),
      })
    ).rejects.toThrow('NoSuchUpload')

    expect(mockPromoteObject).not.toHaveBeenCalled()
  })

  it('rejects a mismatched staged multipart object before provider completion', async () => {
    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES + 1)
    mockHeadObject.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...objectIdentity(created.id, created.fileSize, created.contentType),
      uploadId: 'another-upload',
    })

    await expect(
      completeUploadSession({
        session: created,
        completion: { parts: completedParts(created.partCount) },
        finalize: async () => ({ value: 'file-1' }),
      })
    ).rejects.toThrow('Uploaded object belongs to another upload')

    expect(mockCompleteMultipart).not.toHaveBeenCalled()
    expect(mockPromoteObject).not.toHaveBeenCalled()
  })

  it('retains staging when finalization fails after promotion', async () => {
    const created = await createWorkspaceUpload(1024)
    const identity = objectIdentity(created.id, created.fileSize, created.contentType)
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)

    await expect(
      completeUploadSession({
        session: created,
        completion: {},
        finalize: async () => {
          throw new Error('database unavailable')
        },
      })
    ).rejects.toThrow('database unavailable')

    expect(mockPromoteObject).toHaveBeenCalledOnce()
    expect(mockDeleteObjectVersion).not.toHaveBeenCalled()
  })

  it('retries finalization from an exact final object, then removes staging conditionally', async () => {
    const created = await createWorkspaceUpload(1024)
    const identity = objectIdentity(created.id, created.fileSize, created.contentType)
    mockHeadObject.mockResolvedValueOnce(identity).mockResolvedValueOnce(identity)

    await expect(
      completeUploadSession({
        session: created,
        completion: {},
        finalize: async () => ({ value: 'file-1', completedFileId: 'file-1' }),
      })
    ).resolves.toMatchObject({ value: 'file-1', alreadyCompleted: true })

    expect(mockPromoteObject).not.toHaveBeenCalled()
    expect(mockDeleteObjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ key: created.stagingKey, version: 'version-1' })
    )
  })
})

async function createWorkspaceUpload(fileSize: number) {
  return createUploadSession({
    id: 'upload-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    purpose: 'workspace_file',
    fileName: 'file.bin',
    contentType: 'application/octet-stream',
    fileSize,
  })
}

function objectIdentity(uploadId: string, size: number, contentType: string) {
  return { uploadId, size, contentType, version: 'version-1' }
}

function completedParts(partCount: number | null) {
  return Array.from({ length: partCount ?? 0 }, (_, index) => ({
    partNumber: index + 1,
    etag: `etag-${index + 1}`,
  }))
}
