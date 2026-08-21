/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortUpload: vi.fn(),
  assertBinding: vi.fn(),
  checkUsage: vi.fn(),
  completeUpload: vi.fn(),
  createDocument: vi.fn(),
  createPartUrls: vi.fn(),
  createUpload: vi.fn(),
  findBound: vi.fn(),
  getUpload: vi.fn(),
  processQueue: vi.fn(),
  recordAudit: vi.fn(),
  recordOwnership: vi.fn(),
  resolveBilling: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  validateFileType: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { DOCUMENT_UPLOADED: 'document.uploaded' },
  AuditResourceType: { DOCUMENT: 'document' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mocks.checkUsage,
  resolveBillingAttribution: mocks.resolveBilling,
  resolveSystemBillingAttribution: mocks.resolveBilling,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeBaseContext: mocks.resolveContext,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: mocks.createDocument,
  processDocumentsWithQueue: mocks.processQueue,
}))

vi.mock('@/lib/knowledge/orchestration/documents', () => ({
  findBoundKnowledgeDocument: mocks.findBound,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  recordKnowledgeBaseFileOwnership: mocks.recordOwnership,
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  requestOrigin: () => 'http://localhost:3000',
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: mocks.abortUpload,
  assertUploadSessionAuthBinding: mocks.assertBinding,
  completeUploadSession: mocks.completeUpload,
  createUploadPartUrls: mocks.createPartUrls,
  createUploadSession: mocks.createUpload,
  getPrincipalKnowledgeDocumentUploadSession: mocks.getUpload,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({
  validateFileType: mocks.validateFileType,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelKnowledgeDocumentUpload,
  completeKnowledgeDocumentUpload,
  createKnowledgeDocumentUpload,
  issueKnowledgeDocumentUploadParts,
} from '@/lib/knowledge/application/upload-sessions'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const CONTEXT = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  knowledgeBaseId: 'knowledge-1',
  knowledgeBase: { id: 'knowledge-1', name: 'Docs', workspaceId: 'workspace-1' },
}
const PRINCIPAL = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const BILLING = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: 'organization-1',
  billedAccountUserId: 'billing-owner-1',
  billingEntity: { id: 'organization-1', type: 'organization' },
  billingPeriod: { start: '2026-08-01', end: '2026-09-01' },
  payerSubscription: null,
}
const SESSION: UploadSessionRecord = {
  id: 'upload-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  knowledgeBaseId: 'knowledge-1',
  workflowId: null,
  executionId: null,
  purpose: 'knowledge_document',
  method: 'multipart',
  storageContext: 'knowledge-base',
  storageKey: 'kb/guide.pdf',
  finalKey: 'kb/guide.pdf',
  storageProvider: 's3',
  providerUploadId: 'provider-1',
  providerObjectVersion: null,
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  partSize: 8 * 1024 * 1024,
  partCount: 1,
  status: 'uploading',
  metadata: {
    tag1: 'product',
    processingOptions: { recipe: 'default', lang: 'en' },
    authBinding: {
      version: 1,
      workspaceId: 'workspace-1',
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    },
  },
  uploadToken: 'token',
  createdAt: new Date('2026-08-03T21:00:00.000Z'),
  expiresAt: new Date('2026-08-04T21:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: new Date('2026-08-03T21:00:00.000Z'),
}
const DOCUMENT = {
  id: 'upload-1',
  knowledgeBaseId: 'knowledge-1',
  filename: 'guide.pdf',
  fileUrl: '/api/files/serve/s3/kb%2Fguide.pdf?context=knowledge-base',
  fileSize: 1024,
  mimeType: 'application/pdf',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  enabled: true,
  uploadedAt: new Date('2026-08-03T21:01:00.000Z'),
  tag1: 'product',
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
}
const REQUEST = { headers: new Headers() }

describe('knowledge-document upload application lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(CONTEXT)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveBilling.mockResolvedValue(BILLING)
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
    mocks.validateFileType.mockReturnValue(null)
    mocks.createUpload.mockResolvedValue({
      ...SESSION,
      transfer: { method: 'multipart', partSize: SESSION.partSize, partCount: 1 },
    })
    mocks.recordOwnership.mockResolvedValue(undefined)
    mocks.getUpload.mockResolvedValue(SESSION)
    mocks.createPartUrls.mockResolvedValue([
      {
        partNumber: 1,
        url: 'https://storage.example/1',
        headers: {},
        expiresAt: '2026-08-04T21:00:00.000Z',
      },
    ])
    mocks.abortUpload.mockResolvedValue({ ...SESSION, status: 'aborted' })
    mocks.findBound.mockResolvedValue({ status: 'absent' })
    mocks.createDocument.mockResolvedValue(DOCUMENT)
    mocks.processQueue.mockResolvedValue(undefined)
  })

  it('admits, binds, and records ownership before returning upload credentials', async () => {
    await createKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        name: 'guide.pdf',
        contentType: 'application/pdf',
        size: 1024,
        metadata: { tag1: 'product' },
      },
      request: REQUEST,
    })

    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'knowledge_document',
        principal: PRINCIPAL,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'knowledge-1',
      })
    )
    expect(mocks.recordOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ key: SESSION.storageKey, workspaceId: 'workspace-1' })
    )
    expect(mocks.recordOwnership.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.createUpload.mock.invocationCallOrder[0]
    )
  })

  it('rejects insufficient role before allocating provider state', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      createKnowledgeDocumentUpload.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          name: 'guide.pdf',
          contentType: 'application/pdf',
          size: 1024,
          metadata: {},
        },
        request: REQUEST,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.createUpload).not.toHaveBeenCalled()
  })

  it('aborts provider state and propagates an ownership registration failure', async () => {
    const failure = new Error('ownership database unavailable')
    mocks.recordOwnership.mockRejectedValue(failure)

    await expect(
      createKnowledgeDocumentUpload.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          name: 'guide.pdf',
          contentType: 'application/pdf',
          size: 1024,
          metadata: {},
        },
        request: REQUEST,
      })
    ).rejects.toBe(failure)
    expect(mocks.abortUpload).toHaveBeenCalledWith(expect.objectContaining({ id: 'upload-1' }))
  })

  it('reauthorizes and verifies the immutable credential on the parts leg', async () => {
    await issueKnowledgeDocumentUploadParts.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        partNumbers: [1],
      },
      request: REQUEST,
    })

    expect(mocks.getUpload).toHaveBeenCalledWith(
      expect.objectContaining({ principal: PRINCIPAL, uploadId: 'upload-1' })
    )
    expect(mocks.assertBinding).toHaveBeenCalledWith(SESSION, PRINCIPAL)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
    expect(mocks.createPartUrls).toHaveBeenCalledWith(
      expect.objectContaining({ session: SESSION, partNumbers: [1] })
    )
  })

  it('checks durable binding before canceling', async () => {
    await cancelKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
      },
      request: REQUEST,
    })

    expect(mocks.findBound).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'upload-1', knowledgeBaseId: 'knowledge-1' })
    )
    expect(mocks.abortUpload).toHaveBeenCalledWith(SESSION)
  })

  it('reauthorizes immediately before durable registration and audits the created document', async () => {
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
          completedFileId?: string
        }>
      }) => {
        const finalized = await params.finalize(params.session)
        return {
          session: { ...params.session, status: 'completed' as const },
          value: finalized.value,
          alreadyCompleted: false,
        }
      }
    )

    const result = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(result.value.created).toBe(true)
    expect(mocks.resolvePermission.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.any(Object),
      'knowledge-1',
      expect.any(String),
      'user-1',
      'upload-1',
      undefined,
      { expectedWorkspaceId: 'workspace-1' }
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.uploaded',
        resourceId: 'upload-1',
        metadata: expect.objectContaining({ operation: 'knowledge.documents.upload.complete' }),
      })
    )
  })

  it('returns an already-bound document without re-billing, re-registering, or auditing', async () => {
    mocks.findBound.mockResolvedValue({ status: 'bound', document: DOCUMENT })
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
        }>
      }) => ({
        session: { ...params.session, status: 'completed' as const },
        value: (await params.finalize({ ...params.session, error: null })).value,
        alreadyCompleted: true,
      })
    )

    const result = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(result.value.created).toBe(false)
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.processQueue).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /**
   * The registration is durable before indexing is queued, so a queue that is
   * down cannot un-create the document. Failing the call reports a completion
   * that did happen as a 500, and the only recovery a caller has — replaying the
   * same request — answers `200 completed`.
   */
  it('completes and audits the upload when processing cannot be dispatched', async () => {
    mocks.processQueue.mockRejectedValue(new Error('queue unavailable'))
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
          completedFileId?: string
        }>
      }) => {
        const finalized = await params.finalize(params.session)
        return {
          session: { ...params.session, status: 'completed' as const },
          value: finalized.value,
          alreadyCompleted: false,
        }
      }
    )

    const result = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(result.value.created).toBe(true)
    expect(result.value.document).toEqual(DOCUMENT)
    expect(mocks.createDocument).toHaveBeenCalledTimes(1)
    expect(mocks.processQueue).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })

  /**
   * A completed session with a `completedFileId` replays into `loadCompleted`,
   * which never dispatches, and nothing sweeps `pending`. Leaving the document
   * there strands it with no retry and no signal, so the failure is recorded on
   * the row — the state `retryProcessing` accepts.
   */
  it('marks the document failed when its processing dispatch never got off the ground', async () => {
    mocks.processQueue.mockRejectedValue(new Error('queue unavailable'))
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
          completedFileId?: string
        }>
      }) => {
        const finalized = await params.finalize(params.session)
        return {
          session: { ...params.session, status: 'completed' as const },
          value: finalized.value,
          alreadyCompleted: false,
        }
      }
    )

    await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    const failedWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failedWrite).toBeDefined()
    expect(failedWrite?.[0]).toMatchObject({
      processingStatus: 'failed',
      processingError: 'queue unavailable',
    })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
  })

  /** Recording the failure is itself best-effort; it must not resurface as a 500. */
  it('still completes when the dispatch failure cannot be recorded', async () => {
    mocks.processQueue.mockRejectedValue(new Error('queue unavailable'))
    dbChainMockFns.returning.mockRejectedValue(new Error('database unavailable'))
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
          completedFileId?: string
        }>
      }) => {
        const finalized = await params.finalize(params.session)
        return {
          session: { ...params.session, status: 'completed' as const },
          value: finalized.value,
          alreadyCompleted: false,
        }
      }
    )

    const result = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(result.value.document).toEqual(DOCUMENT)
  })

  /**
   * The dispatch is a follow-on to the completion, not a step inside it: a
   * completion that cannot write its durable marker must not have queued
   * indexing for a document the caller was told nothing about.
   */
  it('queues processing only after the session is durably completed', async () => {
    const order: string[] = []
    mocks.processQueue.mockImplementation(async () => {
      order.push('dispatch')
    })
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
          completedFileId?: string
        }>
      }) => {
        const finalized = await params.finalize(params.session)
        order.push('completed')
        return {
          session: { ...params.session, status: 'completed' as const },
          value: finalized.value,
          alreadyCompleted: false,
        }
      }
    )

    await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(order).toEqual(['completed', 'dispatch'])
  })

  /**
   * The re-queue is decided by the document — a registration still `pending` was
   * never picked up — rather than by the message a previous failure happened to
   * leave on the session. The session no longer carries one: a dispatch failure
   * completes the session and is logged, so keying recovery off `session.error`
   * would leave a `pending` document with nothing to re-queue it.
   */
  it('re-queues a bound registration whose document was never picked up', async () => {
    const recoveringSession = {
      ...SESSION,
      status: 'finalizing' as const,
      completedFileId: null,
    }
    mocks.getUpload.mockResolvedValue(recoveringSession)
    mocks.findBound.mockResolvedValue({
      status: 'bound',
      document: { ...DOCUMENT, processingStatus: 'pending' },
    })
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
        }>
      }) => ({
        session: { ...params.session, status: 'completed' as const },
        value: (await params.finalize({ ...params.session, error: null })).value,
        alreadyCompleted: true,
      })
    )

    const result = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: REQUEST,
    })

    expect(result.value.created).toBe(true)
    expect(mocks.resolveBilling).toHaveBeenCalledTimes(1)
    expect(mocks.processQueue).toHaveBeenCalledTimes(1)
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })

  it('converges a finalization retry after durable bind without duplicate document or audit', async () => {
    const recoveringSession = {
      ...SESSION,
      status: 'finalizing' as const,
      completedFileId: null,
    }
    const completedSession = {
      ...recoveringSession,
      status: 'completed' as const,
      completedFileId: DOCUMENT.id,
    }
    mocks.getUpload.mockResolvedValueOnce(recoveringSession).mockResolvedValueOnce(completedSession)
    mocks.findBound.mockResolvedValue({ status: 'bound', document: DOCUMENT })
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<{
          value: { document: typeof DOCUMENT; created: boolean; knowledgeBaseName: string | null }
        }>
        loadCompleted: (session: UploadSessionRecord) => Promise<{
          document: typeof DOCUMENT
          created: boolean
          knowledgeBaseName: string | null
        }>
      }) => {
        if (params.session.status === 'completed') {
          return {
            session: params.session,
            value: await params.loadCompleted(params.session),
            alreadyCompleted: true,
          }
        }
        return {
          session: completedSession,
          value: (await params.finalize(params.session)).value,
          alreadyCompleted: true,
        }
      }
    )

    const input = {
      knowledgeBaseId: 'knowledge-1',
      assertedWorkspaceId: 'workspace-1',
      uploadId: 'upload-1',
      uploadToken: 'token',
      source: 'api' as const,
    }
    const recovered = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input,
      request: REQUEST,
    })
    const retry = await completeKnowledgeDocumentUpload.execute({
      principal: PRINCIPAL,
      input,
      request: REQUEST,
    })

    expect(recovered.value.created).toBe(true)
    expect(retry.value.created).toBe(false)
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.processQueue).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })

  it('fails fast when billing ownership changes before durable registration', async () => {
    mocks.resolveBilling.mockResolvedValue({ ...BILLING, billedAccountUserId: 'stale-owner' })
    mocks.completeUpload.mockImplementation(
      async (params: {
        session: UploadSessionRecord
        finalize: (session: UploadSessionRecord) => Promise<unknown>
      }) => params.finalize(params.session)
    )

    await expect(
      completeKnowledgeDocumentUpload.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          uploadId: 'upload-1',
          uploadToken: 'token',
          source: 'api',
        },
        request: REQUEST,
      })
    ).rejects.toThrow('billing attribution changed')
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('propagates provider completion failures without audit or registration', async () => {
    const failure = new Error('provider unavailable')
    mocks.completeUpload.mockRejectedValue(failure)

    await expect(
      completeKnowledgeDocumentUpload.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          uploadId: 'upload-1',
          uploadToken: 'token',
          source: 'api',
        },
        request: REQUEST,
      })
    ).rejects.toBe(failure)
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates canonical infrastructure failures without concealment fallback', async () => {
    const failure = new Error('database unavailable')
    mocks.resolveContext.mockRejectedValue(failure)

    await expect(
      issueKnowledgeDocumentUploadParts.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          uploadId: 'upload-1',
          uploadToken: 'token',
          partNumbers: [1],
        },
        request: REQUEST,
      })
    ).rejects.toBe(failure)
  })

  it('conceals an asserted workspace mismatch as not found', async () => {
    mocks.resolveContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    await expect(
      cancelKnowledgeDocumentUpload.execute({
        principal: PRINCIPAL,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'different-workspace',
          uploadId: 'upload-1',
          uploadToken: 'token',
        },
        request: REQUEST,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
