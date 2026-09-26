import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { bulkUpdateKnowledgeChunks, listKnowledgeChunks } from '@/lib/knowledge/application/chunks'

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
