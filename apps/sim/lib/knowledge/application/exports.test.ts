import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listTags: vi.fn(),
  listDocuments: vi.fn(),
  iterateChunks: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/transfer/export-source', () => ({
  listExportableTags: mocks.listTags,
  listExportableDocuments: mocks.listDocuments,
  iterateDocumentChunks: mocks.iterateChunks,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { exportKnowledgeBase } from '@/lib/knowledge/application/exports'

const mockResolveKnowledgeAccessScope = knowledgeAccessScopeMockFns.mockResolveKnowledgeAccessScope

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'billing-owner-1',
  name: 'Support docs',
  description: 'Everything support knows',
  tokenCount: 0,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  workspaceId: 'workspace-1',
  folderId: null,
  docCount: 2,
  connectorTypes: [],
  hasPermissionScopedConnector: false,
}

const principal = createSessionPrincipal()

const documents = [
  {
    id: 'doc-1',
    filename: 'handbook.pdf',
    mimeType: 'application/pdf',
    fileSize: 3,
    enabled: true,
    tokenCount: 12,
    characterCount: 40,
    tags: {},
    file: { kind: 'storage', key: 'kb/handbook.pdf' },
    storedChunkCount: 2,
  },
]

describe('exportKnowledgeBase', () => {
  beforeEach(() => {
    mockResolveKnowledgeAccessScope.mockResolvedValue({ kind: 'workspace', tokens: ['ws', 'pub'] })
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
      access: { get: mockResolveKnowledgeAccessScope },
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.listTags.mockResolvedValue([{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }])
    mocks.listDocuments.mockResolvedValue(documents)
    mocks.iterateChunks.mockReturnValue((async function* () {})())
  })

  it('conceals a base the principal cannot read', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ name: 'NoWorkspaceAccessError' })
    expect(mocks.listDocuments).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  /** The manifest is written last, so a value the format rejects must fail before any byte streams. */
  it('refuses a base whose stored values the bundle format cannot describe', async () => {
    mocks.listDocuments.mockResolvedValueOnce([
      { ...documents[0], tags: { tag1: 'x'.repeat(10_001) } },
    ])

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  /** The written manifest carries the streamed count, so the gate must check the stored one. */
  it('refuses a document holding more chunks than the bundle format describes', async () => {
    mocks.listDocuments.mockResolvedValueOnce([{ ...documents[0], storedChunkCount: 5_001 }])

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('propagates an oversized base without recording audit', async () => {
    mocks.listDocuments.mockRejectedValueOnce(
      new OrchestrationError('payload_too_large', 'Knowledge base has 2001 documents')
    )

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})
