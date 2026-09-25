import { resetDbChainMock } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeDocumentsServiceMock,
  knowledgeDocumentsServiceMockFns,
} from '@sim/testing/mocks/knowledge-documents-service.mock'
import { uploadSessionMock, uploadSessionMockFns } from '@sim/testing/mocks/upload-session.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findBound: vi.fn(),
  validateFileType: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)

vi.mock('@/lib/knowledge/orchestration/documents', () => ({
  findBoundKnowledgeDocument: hoisted.findBound,
}))

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/uploads/upload-session/application', () => ({
  requestOrigin: () => 'http://localhost:3000',
}))

vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)

vi.mock('@/lib/uploads/utils/validation', () => ({
  validateFileType: hoisted.validateFileType,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelKnowledgeDocumentUpload,
  completeKnowledgeDocumentUpload,
  createKnowledgeDocumentUpload,
  issueKnowledgeDocumentUploadParts,
} from '@/lib/knowledge/application/upload-sessions'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const mocks = {
  ...hoisted,
  createDocument: knowledgeDocumentsServiceMockFns.mockCreateSingleDocument,
  processQueue: knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue,
  abortUpload: uploadSessionMockFns.mockAbortUploadSession,
  assertBinding: uploadSessionMockFns.mockAssertUploadSessionAuthBinding,
  completeUpload: uploadSessionMockFns.mockCompleteUploadSession,
  createPartUrls: uploadSessionMockFns.mockCreateUploadPartUrls,
  createUpload: uploadSessionMockFns.mockCreateUploadSession,
  getUpload: uploadSessionMockFns.mockGetPrincipalKnowledgeDocumentUploadSession,
}

billingAttributionMockFns.mockResolveSystemBillingAttribution.mockImplementation(
  (...args: unknown[]) => billingAttributionMockFns.mockResolveBillingAttribution(...args)
)

const CONTEXT = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  knowledgeBaseId: 'knowledge-1',
  knowledgeBase: { id: 'knowledge-1', name: 'Docs', workspaceId: 'workspace-1' },
}
const PRINCIPAL = createPersonalApiKeyPrincipal()
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
      principal: createPersonalApiKeyPrincipal(),
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
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockResolvedValue(CONTEXT)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue(BILLING)
    billingAttributionMockFns.mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
    })
    mocks.validateFileType.mockReturnValue(null)
    mocks.createUpload.mockResolvedValue({
      ...SESSION,
      transfer: { method: 'multipart', partSize: SESSION.partSize, partCount: 1 },
    })
    uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
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

  it('rejects insufficient role before allocating provider state', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')

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
    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).toHaveBeenCalledTimes(2)
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
    expect(
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mock.calls.length
    ).toBeGreaterThanOrEqual(4)
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.any(Object),
      'knowledge-1',
      expect.any(String),
      'user-1',
      'upload-1',
      undefined,
      { expectedWorkspaceId: 'workspace-1' }
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
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
    expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.processQueue).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
  })

  it('fails fast when billing ownership changes before durable registration', async () => {
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({
      ...BILLING,
      billedAccountUserId: 'stale-owner',
    })
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

  it('conceals an asserted workspace mismatch as not found', async () => {
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockRejectedValue(
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
