/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
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

  it('lets a read-role principal export and describes the bundle from the stored base', async () => {
    const result = await exportKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-1', vectors: true },
    })

    expect(mocks.resolveKnowledgeBase).toHaveBeenCalledWith(
      { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-1', vectors: true },
      principal
    )
    expect(result.knowledgeBase).toEqual({
      name: 'Support docs',
      description: 'Everything support knows',
      chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    })
    expect(result.embedding).toEqual({
      model: 'text-embedding-3-small',
      dimension: 1536,
      vectorsIncluded: true,
    })
    expect(result.tags).toEqual([{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }])
    expect(result.documents).toBe(documents)
  })

  it('reads the vector column only when vectors are requested', async () => {
    const withVectors = await exportKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1', vectors: true },
    })
    withVectors.chunks('doc-1')
    expect(mocks.iterateChunks).toHaveBeenLastCalledWith('knowledge-1', 'doc-1', 1536)

    const textOnly = await exportKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1', vectors: false },
    })
    textOnly.chunks('doc-1')
    expect(mocks.iterateChunks).toHaveBeenLastCalledWith('knowledge-1', 'doc-1', null)
    expect(textOnly.embedding.vectorsIncluded).toBe(false)
  })

  it('records the export as an audit event', async () => {
    await exportKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1', vectors: false },
    })

    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.exported',
        resourceType: 'knowledge_base',
        resourceId: 'knowledge-1',
        resourceName: 'Support docs',
        metadata: expect.objectContaining({
          workspaceId: 'workspace-1',
          vectors: false,
          documentCount: 1,
        }),
      })
    )
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

  it('refuses a stored tag definition the bundle format cannot describe', async () => {
    mocks.listTags.mockResolvedValueOnce([
      { slot: 'tag1', displayName: 'Product', fieldType: 'mystery' },
    ])

    await expect(
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: 'knowledge-1', vectors: true },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
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
