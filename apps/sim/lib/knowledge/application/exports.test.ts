import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveAccess: vi.fn(),
  listTags: vi.fn(),
  listDocuments: vi.fn(),
  iterateChunks: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { KNOWLEDGE_BASE_EXPORTED: 'knowledge_base.exported' },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
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

vi.mock('@/lib/knowledge/access/scope', () => ({
  resolveKnowledgeAccessScope: mocks.resolveAccess,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
}))

vi.mock('@/lib/knowledge/transfer/export-source', () => ({
  listExportableTags: mocks.listTags,
  listExportableDocuments: mocks.listDocuments,
  iterateDocumentChunks: mocks.iterateChunks,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { exportKnowledgeBase } from '@/lib/knowledge/application/exports'

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

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

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
    mocks.resolveAccess.mockResolvedValue({ kind: 'workspace', tokens: ['ws', 'pub'] })
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
      access: { get: mocks.resolveAccess },
    })
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.listTags.mockResolvedValue([{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }])
    mocks.listDocuments.mockResolvedValue(documents)
    mocks.iterateChunks.mockReturnValue((async function* () {})())
  })

  it('conceals a base the principal cannot read', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ name: 'NoWorkspaceAccessError' })
    expect(mocks.listDocuments).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
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
    expect(mocks.recordAudit).not.toHaveBeenCalled()
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
    expect(mocks.recordAudit).not.toHaveBeenCalled()
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
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
