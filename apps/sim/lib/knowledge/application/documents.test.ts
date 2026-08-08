/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveDocument: vi.fn(),
  resolvePermission: vi.fn(),
  resolveHumanBilling: vi.fn(),
  resolveSystemBilling: vi.fn(),
  checkUsage: vi.fn(),
  getDocuments: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  processQueue: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    DOCUMENT_UPLOADED: 'document.uploaded',
    DOCUMENT_DELETED: 'document.deleted',
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
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getDocuments: mocks.getDocuments,
  createSingleDocument: mocks.createDocument,
  deleteKnowledgeDocumentInKnowledgeBase: mocks.deleteDocument,
  processDocumentsWithQueue: mocks.processQueue,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
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
