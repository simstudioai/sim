import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveFile: vi.fn(),
  getFile: vi.fn(),
  loadFileContext: vi.fn(),
  getProvenance: vi.fn(),
  readFile: vi.fn(),
  upload: vi.fn(),
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

vi.mock('@/lib/knowledge/documents/storage-upload', () => ({
  uploadKnowledgeArtifact: mocks.upload,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mocks.getProvenance,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchServableWorkspaceFileBuffer: mocks.readFile,
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadFileContext,
  resolveWorkspaceFileReference: mocks.resolveFile,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({ validateFileType: () => null }))

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
    mocks.resolveKnowledgeBase.mockResolvedValue(knowledgeContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveFile.mockImplementation(async (_workspaceId: string, reference: string) =>
      reference === 'file-2'
        ? { ...workspaceFile, id: 'file-2', name: 'second.pdf' }
        : workspaceFile
    )
    mocks.getFile.mockImplementation(async (_workspaceId: string, id: string) =>
      id === 'file-2' ? { ...workspaceFile, id: 'file-2', name: 'second.pdf' } : workspaceFile
    )
    mocks.loadFileContext.mockResolvedValue({
      fileId: workspaceFile.id,
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.readFile.mockResolvedValue({ buffer: Buffer.alloc(100), contentType: 'application/pdf' })
    mocks.upload.mockResolvedValue({
      key: 'kb/copied.pdf',
      path: '/api/files/serve/kb%2Fcopied.pdf',
      metadataId: 'binding-1',
      contentUpdatedAt: new Date(0),
      cleanupEventId: 'guard-1',
    })
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
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(5)
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'report.pdf' }),
      'knowledge-1',
      expect.any(String),
      'dual-workspace-user',
      expect.any(String),
      expect.objectContaining({ content: { status: 'exact', entries: [] } }),
      expect.objectContaining({ expectedWorkspaceId: 'workspace-1' })
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
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.checkUsage).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('refuses an updated source instead of attaching bytes with stale provenance', async () => {
    mocks.getFile
      .mockResolvedValueOnce(workspaceFile)
      .mockResolvedValueOnce({ ...workspaceFile, key: 'workspace/workspace-1/replacement.pdf' })
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
    })
    expect(result).toMatchObject({ added: [], failed: ['file-1'] })
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('leaves the reserved upload unbound if authorization was revoked while reading', async () => {
    mocks.resolvePermission
      .mockResolvedValueOnce('write')
      .mockResolvedValueOnce('write')
      .mockResolvedValueOnce('write')
      .mockResolvedValueOnce(null)
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
    })
    expect(result).toMatchObject({ added: [], failed: ['file-1'] })
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })
  it('refuses a rendered artifact whose contributing file provenance is unavailable', async () => {
    const contributor = {
      fileId: 'asset-1',
      key: 'workspace/workspace-1/asset.png',
      context: 'workspace',
    }
    mocks.readFile.mockResolvedValueOnce({
      buffer: Buffer.alloc(247),
      contentType: 'application/pdf',
      contributingFiles: [contributor],
    })
    mocks.getProvenance
      .mockResolvedValueOnce({ status: 'exact', entries: [] })
      .mockResolvedValueOnce({ status: 'exact', entries: [] })
      .mockResolvedValueOnce({ status: 'unknown' })
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
    })
    expect(result).toMatchObject({ added: [], failed: ['file-1'] })
    expect(mocks.getProvenance).toHaveBeenLastCalledWith('workspace-1', contributor)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before canonical resource resolution', async () => {
    await expect(
      addWorkspaceFilesToKnowledgeBase.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
        input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
})
