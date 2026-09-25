import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
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
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  upload: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/knowledge/documents/storage-upload', () => ({
  uploadKnowledgeArtifact: hoisted.upload,
}))

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/uploads/utils/validation', () => ({ validateFileType: () => null }))

import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'

const mocks = {
  ...hoisted,
  createDocument: knowledgeDocumentsServiceMockFns.mockCreateSingleDocument,
  processQueue: knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue,
}

billingAttributionMockFns.mockResolveSystemBillingAttribution.mockImplementation(
  (...args: unknown[]) => billingAttributionMockFns.mockResolveBillingAttribution(...args)
)

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
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockResolvedValue(
      knowledgeContext
    )
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    workspaceFileManagerMockFns.mockResolveWorkspaceFileReference.mockImplementation(
      async (_workspaceId: string, reference: string) =>
        reference === 'file-2'
          ? { ...workspaceFile, id: 'file-2', name: 'second.pdf' }
          : workspaceFile
    )
    workspaceFileManagerMockFns.mockGetWorkspaceFile.mockImplementation(
      async (_workspaceId: string, id: string) =>
        id === 'file-2' ? { ...workspaceFile, id: 'file-2', name: 'second.pdf' } : workspaceFile
    )
    workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext.mockResolvedValue({
      fileId: workspaceFile.id,
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue(
      { status: 'exact', entries: [] }
    )
    workspaceFileManagerMockFns.mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.alloc(100),
      contentType: 'application/pdf',
    })
    mocks.upload.mockResolvedValue({
      key: 'kb/copied.pdf',
      path: '/api/files/serve/kb%2Fcopied.pdf',
      metadataId: 'binding-1',
      contentUpdatedAt: new Date(0),
      cleanupEventId: 'guard-1',
    })
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'dual-workspace-user',
      workspaceId: 'workspace-1',
    })
    billingAttributionMockFns.mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
    })
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

    expect(knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext).not.toHaveBeenCalled()
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

    expect(
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workspaceFileManagerMockFns.mockResolveWorkspaceFileReference.mock.invocationCallOrder[0]
    )
    expect(
      workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      billingAttributionMockFns.mockResolveBillingAttribution.mock.invocationCallOrder[0]
    )
    expect(
      billingAttributionMockFns.mockCheckAttributedUsageLimits.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.createDocument.mock.invocationCallOrder[0])
    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).toHaveBeenCalledTimes(5)
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
    workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext.mockResolvedValueOnce({
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
    expect(
      workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance
    ).not.toHaveBeenCalled()
    expect(workspaceFileManagerMockFns.mockFetchServableWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(billingAttributionMockFns.mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses an updated source instead of attaching bytes with stale provenance', async () => {
    workspaceFileManagerMockFns.mockGetWorkspaceFile
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
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
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
    workspaceFileManagerMockFns.mockFetchServableWorkspaceFileBuffer.mockResolvedValueOnce({
      buffer: Buffer.alloc(247),
      contentType: 'application/pdf',
      contributingFiles: [contributor],
    })
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance
      .mockResolvedValueOnce({ status: 'exact', entries: [] })
      .mockResolvedValueOnce({ status: 'exact', entries: [] })
      .mockResolvedValueOnce({ status: 'unknown' })
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: delegatedPrincipal,
      input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
    })
    expect(result).toMatchObject({ added: [], failed: ['file-1'] })
    expect(
      workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance
    ).toHaveBeenLastCalledWith('workspace-1', contributor)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before canonical resource resolution', async () => {
    await expect(
      addWorkspaceFilesToKnowledgeBase.execute({
        principal: createWorkspaceApiKeyPrincipal(),
        input: { knowledgeBaseId: 'knowledge-1', fileReferences: ['file-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext).not.toHaveBeenCalled()
    expect(workspaceFileManagerMockFns.mockFetchServableWorkspaceFileBuffer).not.toHaveBeenCalled()
  })
})
