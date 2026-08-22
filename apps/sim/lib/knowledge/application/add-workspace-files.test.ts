/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveFile: vi.fn(),
  loadFileContext: vi.fn(),
  getProvenance: vi.fn(),
  presign: vi.fn(),
  resolveBilling: vi.fn(),
  checkUsage: vi.fn(),
  createDocument: vi.fn(),
  processQueue: vi.fn(),
  recordAudit: vi.fn(),
  platformUploaded: vi.fn(),
  captureServerEvent: vi.fn(),
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
  resolveBillingAttribution: mocks.resolveBilling,
  resolveSystemBillingAttribution: mocks.resolveBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mocks.platformUploaded },
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: mocks.createDocument,
  processDocumentsWithQueue: mocks.processQueue,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))

vi.mock('@/lib/uploads', () => ({
  StorageService: { generatePresignedDownloadUrl: mocks.presign },
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mocks.getProvenance,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadFileContext,
  resolveWorkspaceFileReference: mocks.resolveFile,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({ validateFileType: () => null }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'

const knowledgeContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  knowledgeBaseId: 'knowledge-1',
  knowledgeBase: { id: 'knowledge-1', name: 'Docs' },
}

const workspaceFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  key: 'workspace/workspace-1/file-1-report.pdf',
  name: 'report.pdf',
  path: '/api/files/serve/file-1',
  size: 100,
  type: 'application/pdf',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const delegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'dual-workspace-user',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:knowledge',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
} as const

describe('add workspace files to knowledge base application command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveKnowledgeBase.mockResolvedValue(knowledgeContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveFile.mockResolvedValue(workspaceFile)
    mocks.loadFileContext.mockResolvedValue({
      fileId: workspaceFile.id,
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.presign.mockResolvedValue('https://storage.test/report.pdf')
    mocks.resolveBilling.mockResolvedValue({
      actorUserId: 'dual-workspace-user',
      workspaceId: 'workspace-1',
    })
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
    mocks.createDocument.mockResolvedValue({
      id: 'document-1',
      filename: workspaceFile.name,
      fileUrl: 'https://storage.test/report.pdf',
      fileSize: workspaceFile.size,
      mimeType: workspaceFile.type,
    })
    mocks.processQueue.mockResolvedValue(undefined)
    resetDbChainMock()
  })

  /**
   * A document added from a workspace file has no `connector_id`, so the
   * connector-scoped stuck-document sweep never sees it. Logging the dispatch
   * failure and walking away leaves it `pending`, where nothing finds it again.
   */
  it('marks the document failed when its processing dispatch never got off the ground', async () => {
    mocks.processQueue.mockRejectedValue(new Error('queue unavailable'))

    await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        fileReferences: ['files/report.pdf'],
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

  it('bounds file references before canonical knowledge loading', async () => {
    await expect(
      addWorkspaceFilesToKnowledgeBase.execute({
        principal: delegatedPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          fileReferences: Array.from({ length: 101 }, (_, index) => `files/file-${index}.pdf`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('authorizes canonical scope and admits usage before document creation', async () => {
    await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        fileReferences: ['files/report.pdf'],
        source: 'agent',
      },
    })

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolveFile.mock.invocationCallOrder[0]
    )
    expect(mocks.getProvenance.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolveBilling.mock.invocationCallOrder[0]
    )
    expect(mocks.checkUsage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createDocument.mock.invocationCallOrder[0]
    )
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'report.pdf' }),
      'knowledge-1',
      expect.any(String),
      'dual-workspace-user',
      undefined,
      undefined,
      { expectedWorkspaceId: 'workspace-1' }
    )
  })

  it('conceals a cross-workspace file before provenance, storage, or mutation', async () => {
    mocks.loadFileContext.mockResolvedValueOnce({
      fileId: 'workspace-2-file',
      workspaceId: 'workspace-2',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-2',
    })

    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        fileReferences: ['workspace-2-file'],
      },
    })

    expect(result).toMatchObject({ added: [], failed: ['workspace-2-file'] })
    expect(mocks.getProvenance).not.toHaveBeenCalled()
    expect(mocks.presign).not.toHaveBeenCalled()
    expect(mocks.checkUsage).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('returns partial outcomes and keeps product analytics out of the application', async () => {
    mocks.resolveFile
      .mockResolvedValueOnce(workspaceFile)
      .mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))

    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        fileReferences: ['files/report.pdf', 'files/missing.pdf'],
        source: 'agent',
      },
    })

    expect(result).toMatchObject({
      added: [{ documentId: 'document-1', filename: 'report.pdf' }],
      failed: ['files/missing.pdf'],
      cancelled: false,
    })
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'document-1',
        metadata: expect.objectContaining({
          operation: 'knowledge.documents.add_workspace_files',
        }),
      })
    )
    expect(mocks.platformUploaded).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('stops between document creations while auditing completed items', async () => {
    const controller = new AbortController()
    mocks.resolveFile
      .mockResolvedValueOnce(workspaceFile)
      .mockResolvedValueOnce({ ...workspaceFile, id: 'file-2', name: 'second.pdf' })
    mocks.loadFileContext
      .mockResolvedValueOnce({
        fileId: 'file-1',
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
      .mockResolvedValueOnce({
        fileId: 'file-2',
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
    mocks.createDocument.mockImplementationOnce(async () => {
      controller.abort('user stopped')
      return {
        id: 'document-1',
        filename: 'report.pdf',
        fileUrl: 'https://storage.test/report.pdf',
        fileSize: 100,
        mimeType: 'application/pdf',
      }
    })

    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        fileReferences: ['files/report.pdf', 'files/second.pdf'],
        cancellationSignal: controller.signal,
      },
    })

    expect(result).toMatchObject({ added: [{ documentId: 'document-1' }], cancelled: true })
    expect(mocks.createDocument).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('audits completed documents before propagating a later infrastructure failure', async () => {
    const failure = new Error('document store unavailable')
    mocks.resolveFile
      .mockResolvedValueOnce(workspaceFile)
      .mockResolvedValueOnce({ ...workspaceFile, id: 'file-2', name: 'second.pdf' })
    mocks.loadFileContext
      .mockResolvedValueOnce({
        fileId: 'file-1',
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
      .mockResolvedValueOnce({
        fileId: 'file-2',
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
    mocks.createDocument
      .mockResolvedValueOnce({
        id: 'document-1',
        filename: 'report.pdf',
        fileUrl: 'https://storage.test/report.pdf',
        fileSize: 100,
        mimeType: 'application/pdf',
      })
      .mockRejectedValueOnce(failure)

    await expect(
      addWorkspaceFilesToKnowledgeBase.execute({
        principal: delegatedPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-1',
          assertedWorkspaceId: 'workspace-1',
          fileReferences: ['files/report.pdf', 'files/second.pdf'],
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'document-1' })
    )
    expect(mocks.platformUploaded).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })
})
