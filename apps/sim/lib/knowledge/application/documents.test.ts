import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
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
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  performSingleUpload: vi.fn(),
  performBulkUpload: vi.fn(),
  markTimedOut: vi.fn(),
  retryProcessing: vi.fn(),
  generateKnowledgeBaseFileKey: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

vi.mock('@/lib/knowledge/orchestration/documents', () => ({
  performUploadKnowledgeDocument: hoisted.performSingleUpload,
  performUploadKnowledgeDocuments: hoisted.performBulkUpload,
  performMarkKnowledgeDocumentTimedOut: hoisted.markTimedOut,
  performRetryKnowledgeDocumentProcessing: hoisted.retryProcessing,
}))

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager', () => ({
  generateKnowledgeBaseFileKey: hoisted.generateKnowledgeBaseFileKey,
}))

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import {
  createKnowledgeDocuments,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  readKnowledgeDocument,
  updateKnowledgeDocument,
  uploadKnowledgeDocument,
  upsertKnowledgeDocument,
} from '@/lib/knowledge/application/documents'

const mocks = {
  ...hoisted,
  getDocuments: knowledgeDocumentsServiceMockFns.mockGetDocuments,
  bulkDocumentOperation: knowledgeDocumentsServiceMockFns.mockBulkDocumentOperation,
  bulkDocumentOperationByFilter: knowledgeDocumentsServiceMockFns.mockBulkDocumentOperationByFilter,
  createDocument: knowledgeDocumentsServiceMockFns.mockCreateSingleDocument,
  createDocumentRecords: knowledgeDocumentsServiceMockFns.mockCreateDocumentRecords,
  deleteDocumentById: knowledgeDocumentsServiceMockFns.mockDeleteDocument,
  deleteDocument: knowledgeDocumentsServiceMockFns.mockDeleteKnowledgeDocumentInKnowledgeBase,
  updateDocument: knowledgeDocumentsServiceMockFns.mockUpdateDocument,
  processQueue: knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue,
  getProcessingConfig: knowledgeDocumentsServiceMockFns.mockGetProcessingConfig,
  getDocumentTagDefinitions: knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitions,
}

knowledgeContextsMockFns.mockResolveActiveKnowledgeResourceContext.mockImplementation(
  (...args: unknown[]) => knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext(...args)
)

/** Every mocked context carries the workspace read scope the resolvers would attach. */
const knowledgeAccess = {
  get: async () => WORKSPACE_ACCESS_SCOPE,
  getForDocuments: async () => WORKSPACE_ACCESS_SCOPE,
  getForConnectors: async () => WORKSPACE_ACCESS_SCOPE,
}

const context = {
  access: knowledgeAccess,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  knowledgeBaseId: 'knowledge-1',
  knowledgeBase: { id: 'knowledge-1', name: 'Docs' },
}

const document = {
  id: 'document-1',
  knowledgeBaseId: 'knowledge-1',
  filename: 'guide.pdf',
  fileUrl: '/api/files/serve/guide.pdf',
  fileSize: 42,
  mimeType: 'application/pdf',
  enabled: true,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
}

const uploadFile = {
  buffer: Buffer.alloc(42, 'a'),
  filename: 'guide.pdf',
  fileSize: 42,
  mimeType: 'application/pdf',
}

const storedDocumentInput = {
  filename: uploadFile.filename,
  fileUrl: '/api/files/serve/kb%2Fupload-1?context=knowledge-base',
  fileSize: uploadFile.fileSize,
  mimeType: uploadFile.mimeType,
}

describe('knowledge document application use cases', () => {
  beforeEach(() => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockResolvedValue(context)
    knowledgeContextsMockFns.mockResolveActiveKnowledgeDocumentContext.mockResolvedValue({
      ...context,
      documentId: document.id,
      document,
    })
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      ...context,
      documentId: document.id,
      document,
    })
    billingAttributionMockFns.mockResolveSystemBillingAttribution.mockResolvedValue({
      actorUserId: 'billing-owner-1',
      workspaceId: 'workspace-1',
    })
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    billingAttributionMockFns.mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
    })
    mocks.generateKnowledgeBaseFileKey.mockReturnValue('kb/upload-1')
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      path: '/api/files/serve/kb%2Fupload-1',
      key: 'kb/upload-1',
      name: uploadFile.filename,
      size: uploadFile.fileSize,
      type: uploadFile.mimeType,
    })
    uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
    mocks.createDocument.mockResolvedValue(document)
    mocks.updateDocument.mockResolvedValue(document)
    mocks.processQueue.mockResolvedValue(undefined)
    mocks.createDocumentRecords.mockResolvedValue([
      {
        documentId: document.id,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      },
    ])
    mocks.deleteDocumentById.mockResolvedValue(undefined)
    resetDbChainMock()
    mocks.getProcessingConfig.mockReturnValue({ batchSize: 10, maxConcurrentDocuments: 2 })
    mocks.performBulkUpload.mockResolvedValue({
      success: true,
      documents: [
        {
          documentId: document.id,
          filename: document.filename,
          fileUrl: document.fileUrl,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
        },
      ],
    })
    mocks.getDocumentTagDefinitions.mockResolvedValue([])
    mocks.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    })
  })

  it('rejects a document read after workspace permission is revoked', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(
      readKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'reader' },
        input: { knowledgeBaseId: context.knowledgeBaseId, documentId: document.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getDocumentTagDefinitions).not.toHaveBeenCalled()
  })

  it('enforces personal-key policy before returning a resolved document', async () => {
    knowledgeContextsMockFns.mockResolveActiveKnowledgeDocumentContext.mockResolvedValue({
      ...context,
      allowPersonalApiKeys: false,
      documentId: document.id,
      document,
    })
    await expect(
      readKnowledgeDocument.execute({
        principal: createPersonalApiKeyPrincipal({ userId: 'reader' }),
        input: { knowledgeBaseId: context.knowledgeBaseId, documentId: document.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getDocumentTagDefinitions).not.toHaveBeenCalled()
  })

  /**
   * The document being replaced is looked up and deleted under the caller's
   * access, so a restricted document is neither confirmed nor replaced, and one
   * that leaves the caller's reach mid-request keeps the replacement as an
   * ordinary upload.
   */
  it('replaces only a document the caller may read, under the same access', async () => {
    queueTableRows(schemaMock.document, [{ id: 'existing-1' }])

    const result = await upsertKnowledgeDocument.execute({
      principal: createSessionPrincipal(),
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        resolveBillingAttribution: async () => ({
          actorUserId: 'user-1',
          workspaceId: 'workspace-1',
        }),
        resolveSecretProvenances: () => undefined,
      },
    })

    expect(result).toMatchObject({ isUpdate: true, previousDocumentId: 'existing-1' })
    expect(mocks.deleteDocument).toHaveBeenCalledWith(
      'knowledge-1',
      'existing-1',
      expect.any(String),
      WORKSPACE_ACCESS_SCOPE
    )
    expect(mocks.deleteDocumentById).not.toHaveBeenCalled()
  })

  it('authorizes the canonical knowledge base before listing documents', async () => {
    await listKnowledgeDocuments.execute({
      principal: createSessionPrincipal(),
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        limit: 25,
      },
    })

    expect(knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext).toHaveBeenCalledWith(
      expect.objectContaining({ assertedWorkspaceId: 'workspace-1' }),
      expect.objectContaining({ kind: 'session' })
    )
    expect(
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.getDocuments.mock.invocationCallOrder[0])
    expect(mocks.getDocuments).toHaveBeenCalledWith(
      'knowledge-1',
      expect.any(Object),
      expect.any(String),
      knowledgeAccess
    )
  })

  it('resolves current workspace-key billing while retaining key audit attribution', async () => {
    await uploadKnowledgeDocument.execute({
      principal: createWorkspaceApiKeyPrincipal(),
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        file: uploadFile,
        source: 'v2',
      },
    })

    expect(billingAttributionMockFns.mockResolveSystemBillingAttribution).toHaveBeenCalledWith(
      'workspace-1'
    )
    expect(uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith({
      key: 'kb/upload-1',
      userId: 'billing-owner-1',
      workspaceId: 'workspace-1',
      originalName: 'guide.pdf',
      contentType: 'application/pdf',
      size: 42,
    })
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith({
      file: uploadFile.buffer,
      fileName: uploadFile.filename,
      contentType: uploadFile.mimeType,
      context: 'knowledge-base',
      customKey: 'kb/upload-1',
      preserveKey: true,
      persistMetadata: false,
    })
    expect(
      uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]
    ).toBeLessThan(storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0])
    expect(storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createDocument.mock.invocationCallOrder[0]
    )
    expect(mocks.createDocument).toHaveBeenCalledWith(
      storedDocumentInput,
      'knowledge-1',
      expect.any(String),
      'billing-owner-1',
      undefined,
      undefined,
      {
        expectedWorkspaceId: 'workspace-1',
        processing: {
          processingOptions: {},
          billingAttribution: {
            actorUserId: 'billing-owner-1',
            workspaceId: 'workspace-1',
          },
        },
      }
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.upload',
          actor: createWorkspaceApiKeyPrincipal(),
        }),
      })
    )
  })

  it('leaves only a sweepable knowledge-base binding when final authorization fails', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
      .mockResolvedValueOnce('write')
      .mockResolvedValueOnce(null)

    await expect(
      uploadKnowledgeDocument.execute({
        principal: createSessionPrincipal(),
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          file: uploadFile,
          usageAdmission: 'pre_admitted',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledOnce()
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'knowledge-base', persistMetadata: false })
    )
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('conceals a cross-knowledge-base document before deletion and audit', async () => {
    knowledgeContextsMockFns.mockResolveActiveKnowledgeDocumentContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Document not found')
    )

    await expect(
      deleteKnowledgeDocument.execute({
        principal: createSessionPrincipal(),
        input: {
          knowledgeBaseId: 'knowledge-1',
          documentId: 'document-from-another-kb',
          assertedWorkspaceId: 'workspace-1',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.deleteDocument).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('rejects a cross-workspace document update before current membership or mutation', async () => {
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValueOnce(
      {
        ...context,
        workspaceId: 'workspace-b',
        billedAccountUserId: 'billing-owner-b',
        knowledgeBaseId: 'knowledge-b',
        knowledgeBase: { id: 'knowledge-b', name: 'Workspace B docs' },
        documentId: 'document-b',
        document: { ...document, id: 'document-b', knowledgeBaseId: 'knowledge-b' },
      }
    )

    await expect(
      updateKnowledgeDocument.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'shared-user',
          workspaceId: 'workspace-a',
          delegationId: 'tool-call-1',
          audience: 'sim:knowledge',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          resourceScope: {},
        },
        input: {
          knowledgeBaseId: 'knowledge-b',
          documentId: 'document-b',
          assertedWorkspaceId: 'workspace-a',
          filename: 'renamed.pdf',
        },
      })
    ).rejects.toMatchObject({
      name: 'DelegatedWorkspaceAuthorizationError',
      code: 'forbidden',
    })

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.updateDocument).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('rejects a tag value that does not match its definition type', async () => {
    mocks.getDocumentTagDefinitions.mockResolvedValueOnce([
      {
        id: 'priority-tag',
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'number1',
        displayName: 'Priority',
        fieldType: 'number',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await expect(
      updateKnowledgeDocument.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'shared-user',
          workspaceId: 'workspace-1',
          delegationId: 'tool-call-1',
          audience: 'sim:knowledge',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          resourceScope: {},
        },
        input: {
          knowledgeBaseId: 'knowledge-1',
          documentId: 'document-1',
          assertedWorkspaceId: 'workspace-1',
          tagValues: [{ tagDefinitionId: 'priority-tag', value: 'urgent' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Tag "Priority" expects a number value, but received "urgent"',
    })

    expect(mocks.updateDocument).not.toHaveBeenCalled()
  })

  it('bounds bulk document creation before billing or orchestration', async () => {
    await expect(
      createKnowledgeDocuments.execute({
        principal: createSessionPrincipal(),
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          documents: Array.from({ length: 101 }, (_, index) => ({
            filename: `document-${index}.txt`,
            fileUrl: `/document-${index}.txt`,
            fileSize: 1,
            mimeType: 'text/plain',
          })),
          bulk: true,
          resolveSecretProvenances: () => undefined,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(billingAttributionMockFns.mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mocks.performBulkUpload).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})
