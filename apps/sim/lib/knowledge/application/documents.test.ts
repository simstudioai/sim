/**
 * @vitest-environment node
 */

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
  recordAudit: vi.fn(),
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
  resolveActiveKnowledgeDocumentContext: mocks.resolveDocument,
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.resolveCanonicalDocument,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getDocuments: mocks.getDocuments,
  createSingleDocument: mocks.createDocument,
  deleteKnowledgeDocumentInKnowledgeBase: mocks.deleteDocument,
  updateDocument: mocks.updateDocument,
  processDocumentsWithQueue: mocks.processQueue,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  updateKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'

const context = {
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
    mocks.createDocument.mockResolvedValue(document)
    mocks.updateDocument.mockResolvedValue(document)
    mocks.processQueue.mockResolvedValue(undefined)
    mocks.getDocuments.mockResolvedValue({
      documents: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    })
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
      expect.objectContaining({ assertedWorkspaceId: 'workspace-1' })
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
        document,
        source: 'v2',
      },
    })

    expect(mocks.resolveSystemBilling).toHaveBeenCalledWith('workspace-1')
    expect(mocks.createDocument).toHaveBeenCalledWith(
      document,
      'knowledge-1',
      expect.any(String),
      'billing-owner-1',
      undefined,
      undefined,
      { expectedWorkspaceId: 'workspace-1' }
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
        document,
        usageAdmission: 'pre_admitted',
      },
    })

    expect(mocks.checkUsage).not.toHaveBeenCalled()
    expect(mocks.createDocument).toHaveBeenCalledOnce()
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
      expect.any(String)
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

  it('propagates document infrastructure failures without audit', async () => {
    const failure = new Error('storage ledger unavailable')
    mocks.createDocument.mockRejectedValueOnce(failure)

    await expect(
      uploadKnowledgeDocument.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          document,
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
