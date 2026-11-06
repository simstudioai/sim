import type { Principal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitKnowledgeChunks: vi.fn(),
  queryChunks: vi.fn(),
  batchChunkOperation: vi.fn(),
  createChunk: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

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

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/lib/knowledge/application/admit-knowledge-content', () => ({
  admitKnowledgeChunks: mocks.admitKnowledgeChunks,
}))

import { admitContent } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import {
  bulkUpdateKnowledgeChunks,
  createKnowledgeChunk,
  listKnowledgeChunks,
} from '@/lib/knowledge/application/chunks'

describe('knowledge chunk application use cases', () => {
  beforeEach(() => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      access: { get: async () => WORKSPACE_ACCESS_SCOPE },
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'processing' },
    })
  })

  /** Stands in for the gate's verdicts; accounting is the real primitive's, as the helper's is. */
  function admitOnly(ids: string[]) {
    mocks.admitKnowledgeChunks.mockImplementation(async (principal: Principal) => {
      await admitContent(principal, [])
      return new Set(ids)
    })
  }

  it('admits a created chunk with the document name its response shows', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      access: { get: async () => WORKSPACE_ACCESS_SCOPE },
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1', embeddingModel: 'text-embedding-3-small' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'completed', filename: 'named.txt' },
    })
    mocks.createChunk.mockResolvedValue({ id: 'chunk-new', content: 'body', tokenCount: 1 })
    admitOnly(['chunk-new'])

    const result = await createKnowledgeChunk.execute({
      principal: createSessionPrincipal(),
      input: {
        knowledgeBaseId: 'knowledge-1',
        documentId: 'document-1',
        content: 'body',
        resolveContentProvenance: () => undefined,
      },
    })

    expect(result.chunk.documentName).toBe('named.txt')
    const [, [item]] = mocks.admitKnowledgeChunks.mock.calls[0]
    expect(item.value).toMatchObject({ documentId: 'document-1', documentName: 'named.txt' })
  })

  it('returns a typed transient failure before querying chunks for a processing document', async () => {
    const promise = listKnowledgeChunks.execute({
      principal: createSessionPrincipal(),
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

  /**
   * A connector owns its documents' chunks, so a direct edit would be silently
   * reverted by the next sync. The refusal names its cause, because exposing
   * chunk writes publicly makes it a 403 a client has to branch on.
   */
  it('refuses a write to a connector-synced document with a machine-readable cause', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      access: { get: async () => WORKSPACE_ACCESS_SCOPE },
      knowledgeBaseId: 'knowledge-1',
      knowledgeBase: { id: 'knowledge-1' },
      documentId: 'document-1',
      document: { id: 'document-1', processingStatus: 'completed', connectorId: 'connector-1' },
    })

    const promise = bulkUpdateKnowledgeChunks.execute({
      principal: createSessionPrincipal(),
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
