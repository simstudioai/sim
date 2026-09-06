/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveDocument: vi.fn(),
  resolvePermission: vi.fn(),
  queryChunks: vi.fn(),
  batchChunkOperation: vi.fn(),
  createChunk: vi.fn(),
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
  batchChunkOperation: mocks.batchChunkOperation,
  createChunk: mocks.createChunk,
  deleteChunk: vi.fn(),
  queryChunks: mocks.queryChunks,
  updateChunk: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  createDurableSecretProvenanceRegistry: vi.fn(),
}))

vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  runWithKnowledgeModelInputProvenance: (_registry: unknown, execute: () => Promise<unknown>) =>
    execute(),
}))

vi.mock('@/providers/utils', () => ({ calculateCost: vi.fn() }))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import {
  bulkUpdateKnowledgeChunks,
  createKnowledgeChunk,
  listKnowledgeChunks,
} from '@/lib/knowledge/application/chunks'

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

  it('copies document tag values into a newly created chunk without a separate tagging operation', async () => {
    mocks.resolvePermission.mockResolvedValue('write')
    const tags = {
      tag1: 'billing',
      tag2: null,
      tag3: null,
      tag4: null,
      tag5: null,
      tag6: null,
      tag7: null,
      number1: '2026',
      number2: null,
      number3: null,
      number4: null,
      number5: null,
      date1: '2026-09-01',
      date2: null,
      boolean1: 'false',
      boolean2: null,
      boolean3: null,
    }
    mocks.resolveDocument.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1', userId: 'owner-1', embeddingModel: 'model' },
      documentId: 'document-1',
      document: {
        id: 'document-1',
        filename: 'handbook.md',
        processingStatus: 'completed',
        ...tags,
      },
    })
    mocks.createChunk.mockResolvedValue({ id: 'chunk-1', tokenCount: 12, ...tags })
    const result = await createKnowledgeChunk.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        documentId: 'document-1',
        content: 'Refund policy',
        enabled: true,
        resolveContentProvenance: () => undefined,
      },
    })
    expect(mocks.createChunk).toHaveBeenCalledWith(
      'knowledge-1',
      'document-1',
      tags,
      { content: 'Refund policy', enabled: true },
      expect.any(String),
      'workspace-1',
      undefined
    )
    expect(result.chunk).toMatchObject({ id: 'chunk-1', documentId: 'document-1', ...tags })
  })

  it('passes a keyset position straight through to the chunk query', async () => {
    mocks.resolveDocument.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'completed' },
    })
    mocks.queryChunks.mockResolvedValue({
      chunks: [],
      nextCursorKeys: null,
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    })

    const result = await listKnowledgeChunks.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        documentId: 'document-1',
        cursorKeys: [3, 'chunk-3'],
      },
    })

    expect(mocks.queryChunks).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({ cursorKeys: [3, 'chunk-3'] }),
      expect.any(String)
    )
    expect(result.nextCursorKeys).toBeNull()
  })

  /**
   * A connector owns its documents' chunks, so a direct edit would be silently
   * reverted by the next sync. The refusal names its cause, because exposing
   * chunk writes publicly makes it a 403 a client has to branch on.
   */
  it('refuses a write to a connector-synced document with a machine-readable cause', async () => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveDocument.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'completed', connectorId: 'connector-1' },
    })

    const promise = bulkUpdateKnowledgeChunks.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        documentId: 'document-1',
        operation: 'delete',
        chunkIds: ['chunk-1'],
      },
    })

    await expect(promise).rejects.toBeInstanceOf(ForbiddenOperationError)
    await expect(promise).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
    })
    expect(mocks.batchChunkOperation).not.toHaveBeenCalled()
  })
})
