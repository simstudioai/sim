/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveDocument: vi.fn(),
  resolvePermission: vi.fn(),
  queryChunks: vi.fn(),
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

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.resolveDocument,
  resolveActiveKnowledgeChunkContext: vi.fn(),
}))

vi.mock('@/lib/knowledge/chunks/service', () => ({
  batchChunkOperation: vi.fn(),
  createChunk: vi.fn(),
  deleteChunk: vi.fn(),
  queryChunks: mocks.queryChunks,
  updateChunk: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  createDurableSecretProvenanceRegistry: vi.fn(),
}))

vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  runWithKnowledgeModelInputProvenance: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({ calculateCost: vi.fn() }))

import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'

describe('knowledge chunk application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveDocument.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'processing' },
    })
  })

  it('returns a typed transient failure before querying chunks for a processing document', async () => {
    const promise = listKnowledgeChunks.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { knowledgeBaseId: 'knowledge-1', documentId: 'document-1' },
    })

    await expect(promise).rejects.toBeInstanceOf(KnowledgeDocumentNotReadyError)
    await expect(promise).rejects.toMatchObject({
      code: 'validation',
      processingStatus: 'processing',
      message: 'Document is not ready for access (status: processing)',
    })
    expect(mocks.queryChunks).not.toHaveBeenCalled()
  })
})
