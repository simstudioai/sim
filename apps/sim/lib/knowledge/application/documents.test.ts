/**
 * @vitest-environment node
 */

import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveDocument: vi.fn(),
  resolveCanonicalDocument: vi.fn(),
  resolvePermission: vi.fn(),
  resolveHumanBilling: vi.fn(),
  resolveSystemBilling: vi.fn(),
  checkUsage: vi.fn(),
  getDocuments: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  updateDocument: vi.fn(),
  processQueue: vi.fn(),
  createDocumentRecords: vi.fn(),
  deleteDocumentById: vi.fn(),
  getProcessingConfig: vi.fn(),
  performSingleUpload: vi.fn(),
  performBulkUpload: vi.fn(),
  markTimedOut: vi.fn(),
  retryProcessing: vi.fn(),
  uploadStoredFile: vi.fn(),
  generateKnowledgeBaseFileKey: vi.fn(),
  recordKnowledgeBaseFileOwnership: vi.fn(),
  recordAudit: vi.fn(),
  captureServerEvent: vi.fn(),
  getDocumentTagDefinitions: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    DOCUMENT_UPLOADED: 'document.uploaded',
    DOCUMENT_DELETED: 'document.deleted',
    DOCUMENT_UPDATED: 'document.updated',
  },
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
  resolveBillingAttribution: mocks.resolveHumanBilling,
  resolveSystemBillingAttribution: mocks.resolveSystemBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeResourceContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeDocumentContext: mocks.resolveDocument,
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.resolveCanonicalDocument,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getDocuments: mocks.getDocuments,
  createSingleDocument: mocks.createDocument,
  createDocumentRecords: mocks.createDocumentRecords,
  deleteDocument: mocks.deleteDocumentById,
  deleteKnowledgeDocumentInKnowledgeBase: mocks.deleteDocument,
  updateDocument: mocks.updateDocument,
  processDocumentsWithQueue: mocks.processQueue,
  getProcessingConfig: mocks.getProcessingConfig,
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mocks.getDocumentTagDefinitions,
}))

vi.mock('@/lib/knowledge/orchestration/documents', () => ({
  performUploadKnowledgeDocument: mocks.performSingleUpload,
  performUploadKnowledgeDocuments: mocks.performBulkUpload,
  performMarkKnowledgeDocumentTimedOut: mocks.markTimedOut,
  performRetryKnowledgeDocumentProcessing: mocks.retryProcessing,
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mocks.uploadStoredFile },
}))

vi.mock('@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager', () => ({
  generateKnowledgeBaseFileKey: mocks.generateKnowledgeBaseFileKey,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  recordKnowledgeBaseFileOwnership: mocks.recordKnowledgeBaseFileOwnership,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import {
  bulkDeleteKnowledgeDocuments,
  createKnowledgeDocuments,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  updateKnowledgeDocument,
  uploadKnowledgeDocument,
  upsertKnowledgeDocument,
} from '@/lib/knowledge/application/documents'

/** Every mocked context carries the workspace read scope the resolvers would attach. */
const knowledgeAccess = { get: async () => WORKSPACE_ACCESS_SCOPE }

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
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveKnowledgeBase.mockResolvedValue(context)
    mocks.resolveDocument.mockResolvedValue({
      ...context,
      documentId: document.id,
      document,
    })
    mocks.resolveCanonicalDocument.mockResolvedValue({
      ...context,
      documentId: document.id,
      document,
    })
    mocks.resolveSystemBilling.mockResolvedValue({
      actorUserId: 'billing-owner-1',
      workspaceId: 'workspace-1',
    })
    mocks.resolveHumanBilling.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
    mocks.generateKnowledgeBaseFileKey.mockReturnValue('kb/upload-1')
    mocks.uploadStoredFile.mockResolvedValue({
      path: '/api/files/serve/kb%2Fupload-1',
      key: 'kb/upload-1',
      name: uploadFile.filename,
      size: uploadFile.fileSize,
      type: uploadFile.mimeType,
    })
    mocks.recordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
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
    mocks.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    })
  })

  /**
   * An upserted document has no `connector_id`, so the connector-scoped
   * stuck-document sweep never sees it. Logging the dispatch failure and walking
   * away leaves it `pending`, where nothing finds it again.
   */
  it('marks an upserted document failed when its dispatch never got off the ground', async () => {
    mocks.processQueue.mockRejectedValue(new Error('queue unavailable'))

    await upsertKnowledgeDocument.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
    // The dispatch is fire-and-forget, so the unwind runs on a later microtask.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const failureWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failureWrite?.[0]).toMatchObject({
      processingStatus: 'failed',
      processingError: 'queue unavailable',
    })
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
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

  it('keeps the replacement when the previous document left the caller’s reach', async () => {
    queueTableRows(schemaMock.document, [{ id: 'existing-1' }])
    mocks.deleteDocument.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Document not found')
    )

    const result = await upsertKnowledgeDocument.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

    expect(result).toMatchObject({ isUpdate: false, previousDocumentId: null })
    expect(mocks.deleteDocumentById).not.toHaveBeenCalled()
  })

  it('authorizes the canonical knowledge base before listing documents', async () => {
    await listKnowledgeDocuments.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        limit: 25,
      },
    })

    expect(mocks.resolveKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ assertedWorkspaceId: 'workspace-1' }),
      expect.objectContaining({ kind: 'session' })
    )
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getDocuments.mock.invocationCallOrder[0]
    )
  })

  it('resolves current workspace-key billing while retaining key audit attribution', async () => {
    await uploadKnowledgeDocument.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        file: uploadFile,
        source: 'v2',
      },
    })

    expect(mocks.resolveSystemBilling).toHaveBeenCalledWith('workspace-1')
    expect(mocks.recordKnowledgeBaseFileOwnership).toHaveBeenCalledWith({
      key: 'kb/upload-1',
      userId: 'billing-owner-1',
      workspaceId: 'workspace-1',
      originalName: 'guide.pdf',
      contentType: 'application/pdf',
      size: 42,
    })
    expect(mocks.uploadStoredFile).toHaveBeenCalledWith({
      file: uploadFile.buffer,
      fileName: uploadFile.filename,
      contentType: uploadFile.mimeType,
      context: 'knowledge-base',
      customKey: 'kb/upload-1',
      preserveKey: true,
      persistMetadata: false,
    })
    expect(mocks.recordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.uploadStoredFile.mock.invocationCallOrder[0]
    )
    expect(mocks.uploadStoredFile.mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.upload',
          actor: {
            kind: 'workspace_api_key',
            keyId: 'key-1',
            workspaceId: 'workspace-1',
          },
        }),
      })
    )
  })

  it('does not repeat usage admission after a code-defined pre-admission', async () => {
    await uploadKnowledgeDocument.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        file: uploadFile,
        usageAdmission: 'pre_admitted',
      },
    })

    expect(mocks.checkUsage).not.toHaveBeenCalled()
    expect(mocks.createDocument).toHaveBeenCalledOnce()
  })

  /**
   * The size guard was upper-bound only, so a zero-byte file was admitted, put
   * in storage, and registered — even though every parser refuses an empty
   * buffer outright, so the document could only ever end up `failed`. An input
   * the system provably cannot process belongs to the caller, not to storage.
   */
  it('rejects a zero-byte upload before it reaches storage', async () => {
    await expect(
      uploadKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          file: { ...uploadFile, buffer: Buffer.alloc(0), fileSize: 0 },
          usageAdmission: 'pre_admitted',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.uploadStoredFile).not.toHaveBeenCalled()
    expect(mocks.recordKnowledgeBaseFileOwnership).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('leaves only a sweepable knowledge-base binding when final authorization fails', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('write').mockResolvedValueOnce(null)

    await expect(
      uploadKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          file: uploadFile,
          usageAdmission: 'pre_admitted',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.recordKnowledgeBaseFileOwnership).toHaveBeenCalledOnce()
    expect(mocks.uploadStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'knowledge-base', persistMetadata: false })
    )
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('conceals a cross-knowledge-base document before deletion and audit', async () => {
    mocks.resolveDocument.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Document not found')
    )

    await expect(
      deleteKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          documentId: 'document-from-another-kb',
          assertedWorkspaceId: 'workspace-1',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.deleteDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('carries canonical knowledge-base scope through deletion and audit', async () => {
    await deleteKnowledgeDocument.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        documentId: 'document-1',
        assertedWorkspaceId: 'workspace-1',
        source: 'v2',
      },
    })

    expect(mocks.deleteDocument).toHaveBeenCalledWith(
      'knowledge-1',
      'document-1',
      expect.any(String),
      WORKSPACE_ACCESS_SCOPE
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.deleted',
        resourceId: 'document-1',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.delete',
          knowledgeBaseId: 'knowledge-1',
        }),
      })
    )
  })

  it('rejects a cross-workspace document update before current membership or mutation', async () => {
    mocks.resolveCanonicalDocument.mockResolvedValueOnce({
      ...context,
      workspaceId: 'workspace-b',
      billedAccountUserId: 'billing-owner-b',
      knowledgeBaseId: 'knowledge-b',
      knowledgeBase: { id: 'knowledge-b', name: 'Workspace B docs' },
      documentId: 'document-b',
      document: { ...document, id: 'document-b', knowledgeBaseId: 'knowledge-b' },
    })

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

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.updateDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('authorizes and audits a same-workspace delegated document update', async () => {
    await updateKnowledgeDocument.execute({
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
        enabled: false,
        source: 'agent',
      },
    })

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateDocument.mock.invocationCallOrder[0]
    )
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'document-1',
      { filename: undefined, enabled: false },
      expect.any(String)
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.updated',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.update',
          enabled: false,
          actor: expect.objectContaining({ kind: 'delegated', serviceId: 'copilot' }),
        }),
      })
    )
  })

  it('resolves typed tag-definition assignments into document tag slots', async () => {
    mocks.getDocumentTagDefinitions.mockResolvedValueOnce([
      {
        id: 'category-tag',
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'tag1',
        displayName: 'Category',
        fieldType: 'text',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'priority-tag',
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'number1',
        displayName: 'Priority',
        fieldType: 'number',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'reviewed-tag',
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'boolean1',
        displayName: 'Reviewed',
        fieldType: 'boolean',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await updateKnowledgeDocument.execute({
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
        tagValues: [
          { tagDefinitionId: 'category-tag', value: 'support' },
          { tagDefinitionId: 'priority-tag', value: 2 },
          { tagDefinitionId: 'reviewed-tag', value: false },
        ],
        source: 'agent',
      },
    })

    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'document-1',
      {
        filename: undefined,
        enabled: undefined,
        tag1: 'support',
        number1: '2',
        boolean1: 'false',
      },
      expect.any(String)
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tagDefinitionIds: ['category-tag', 'priority-tag', 'reviewed-tag'],
        }),
      })
    )
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

  it('propagates document infrastructure failures without audit', async () => {
    const failure = new Error('storage ledger unavailable')
    mocks.createDocument.mockRejectedValueOnce(failure)

    await expect(
      uploadKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          file: uploadFile,
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('commits a durable processing intent instead of dispatching from the request', async () => {
    await uploadKnowledgeDocument.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        file: uploadFile,
        processingOptions: { recipe: 'default', lang: 'en' },
      },
    })

    expect(mocks.createDocument).toHaveBeenCalledWith(
      storedDocumentInput,
      'knowledge-1',
      expect.any(String),
      'user-1',
      undefined,
      undefined,
      expect.objectContaining({
        processing: {
          processingOptions: { recipe: 'default', lang: 'en' },
          billingAttribution: { actorUserId: 'user-1', workspaceId: 'workspace-1' },
        },
      })
    )
    expect(mocks.processQueue).not.toHaveBeenCalled()
  })

  it('bounds bulk document creation before billing or orchestration', async () => {
    await expect(
      createKnowledgeDocuments.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

    expect(mocks.checkUsage).not.toHaveBeenCalled()
    expect(mocks.performBulkUpload).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('disables legacy analytics and projects delegated audit for bulk creation', async () => {
    await createKnowledgeDocuments.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'shared-user',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        documents: [
          {
            filename: document.filename,
            fileUrl: document.fileUrl,
            fileSize: document.fileSize,
            mimeType: document.mimeType,
          },
        ],
        bulk: true,
        source: 'agent',
        resolveSecretProvenances: () => undefined,
      },
    })

    expect(mocks.performBulkUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'shared-user',
        recordSemanticAudit: false,
        recordProductAnalytics: false,
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        action: 'document.uploaded',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.upload',
          actor: expect.objectContaining({ kind: 'delegated', serviceId: 'copilot' }),
        }),
      })
    )
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('bounds best-effort document deletion before canonical knowledge loading', async () => {
    await expect(
      bulkDeleteKnowledgeDocuments.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          documentIds: Array.from({ length: 101 }, (_, index) => `document-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.deleteDocument).not.toHaveBeenCalled()
  })

  it('conceals a cross-knowledge-base bulk document before mutation for a dual-workspace subject', async () => {
    mocks.resolveCanonicalDocument.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Document not found')
    )

    const result = await bulkDeleteKnowledgeDocuments.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'dual-workspace-user',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        documentIds: ['workspace-2-document'],
      },
    })

    expect(result).toMatchObject({ deleted: [], failed: ['workspace-2-document'] })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'dual-workspace-user',
      'workspace-1',
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.deleteDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('returns partial document outcomes and keeps product analytics out of the application', async () => {
    mocks.resolveCanonicalDocument.mockImplementation(async ({ documentId }) => ({
      ...context,
      documentId,
      document: { ...document, id: documentId, filename: `${documentId}.pdf` },
    }))
    mocks.deleteDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new OrchestrationError('conflict', 'Document is locked'))

    const result = await bulkDeleteKnowledgeDocuments.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        documentIds: ['document-1', 'document-2'],
        source: 'agent',
      },
    })

    expect(result).toMatchObject({
      deleted: ['document-1'],
      failed: ['document-2'],
      cancelled: false,
    })
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(3)
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'document-1',
        metadata: expect.objectContaining({ operation: 'knowledge.documents.bulk_delete' }),
      })
    )
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('stops between document deletions while auditing completed items', async () => {
    const controller = new AbortController()
    mocks.resolveCanonicalDocument.mockImplementation(async ({ documentId }) => ({
      ...context,
      documentId,
      document: { ...document, id: documentId },
    }))
    mocks.deleteDocument.mockImplementationOnce(async () => {
      controller.abort('user stopped')
    })

    const result = await bulkDeleteKnowledgeDocuments.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        documentIds: ['document-1', 'document-2'],
        cancellationSignal: controller.signal,
      },
    })

    expect(result).toMatchObject({ deleted: ['document-1'], cancelled: true })
    expect(mocks.deleteDocument).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('audits completed document deletions before propagating infrastructure failure', async () => {
    const failure = new Error('document store unavailable')
    mocks.resolveCanonicalDocument.mockImplementation(async ({ documentId }) => ({
      ...context,
      documentId,
      document: { ...document, id: documentId },
    }))
    mocks.deleteDocument.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)

    await expect(
      bulkDeleteKnowledgeDocuments.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          documentIds: ['document-1', 'document-2'],
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'document-1' })
    )
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })
})
