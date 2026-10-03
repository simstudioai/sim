import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { knowledgeSearchUseCaseMock } from '@sim/testing/mocks/knowledge-search-use-case.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listKnowledgeTags: { execute: vi.fn() },
  syncKnowledgeConnector: { execute: vi.fn() },
  connectorSynced: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/knowledge/api/internal-route', () => ({
  internalKnowledgeProvenanceUserId: (_headers: Headers, principal: { subjectUserId?: string }) =>
    principal.subjectUserId ?? 'billing-owner',
  internalKnowledgeAnalytics: {
    connectorSynced: mocks.connectorSynced,
    documentDeleted: vi.fn(),
    documentUpserted: vi.fn(),
    documentsUploaded: vi.fn(),
  },
  toInternalKnowledgeChunk: (value: unknown) => value,
  toInternalKnowledgeConnector: (value: unknown) => value,
  toInternalKnowledgeConnectorDetail: (value: unknown) => value,
  toInternalKnowledgeDocument: (value: unknown) => value,
  toInternalKnowledgeTag: (value: unknown) => value,
}))

vi.mock('@/lib/knowledge/api/secret-provenance', () => ({
  finalizeKnowledgePersistedResponse: vi.fn().mockResolvedValue({}),
  finalizeKnowledgeProvenanceResponse: vi.fn().mockResolvedValue({}),
  finalizeKnowledgeRegistryResponse: vi.fn().mockReturnValue({}),
  resolveKnowledgeDocumentWriteSecretProvenance: vi.fn().mockReturnValue({ success: true }),
  resolveKnowledgeWriteSecretProvenance: vi.fn().mockReturnValue({ success: true }),
}))

vi.mock('@/lib/knowledge/application/chunks', () => ({
  createKnowledgeChunk: { execute: vi.fn() },
  deleteKnowledgeChunk: { execute: vi.fn() },
  listKnowledgeChunks: { execute: vi.fn() },
  updateKnowledgeChunk: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/connectors', () => ({
  listKnowledgeConnectors: { execute: vi.fn() },
  readKnowledgeConnector: { execute: vi.fn() },
  syncKnowledgeConnector: mocks.syncKnowledgeConnector,
}))

vi.mock('@/lib/knowledge/application/documents', () => ({
  createKnowledgeDocuments: { execute: vi.fn() },
  deleteKnowledgeDocument: { execute: vi.fn() },
  listKnowledgeDocuments: { execute: vi.fn() },
  readKnowledgeDocument: { execute: vi.fn() },
  upsertKnowledgeDocument: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: mocks.listKnowledgeTags,
}))

vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  prepareKnowledgeModelInputProvenance: vi.fn(),
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: vi.fn(),
}))

const { mockRequireWorkspaceBillingAttributionHeader } = billingAttributionMockFns

import {
  type KnowledgeOperationContext,
  syncConnectorOperation,
} from '@/lib/internal/knowledge/operations'

const principal = createExecutorPrincipal({
  subjectUserId: 'trusted-user',
  audience: 'sim:knowledge',
  expiresAt: new Date('2026-01-01T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
})

function createContext(): KnowledgeOperationContext {
  return { principal, headers: new Headers({ 'x-billing': 'snapshot' }) }
}

describe('Knowledge direct operations', () => {
  it('restores exact billing attribution before the canonical connector sync use case', async () => {
    const attribution = { actorUserId: 'trusted-user', workspaceId: 'workspace-1' }
    mockRequireWorkspaceBillingAttributionHeader.mockReturnValue(attribution)
    mocks.syncKnowledgeConnector.execute.mockImplementation(async ({ input }) => {
      await expect(input.resolveBillingAttribution('workspace-1')).resolves.toBe(attribution)
      return {
        knowledgeBaseId: 'kb-1',
        workspaceId: 'workspace-1',
        connectorId: 'connector-1',
        connectorType: 'notion',
      }
    })
    const context = createContext()

    const result = await syncConnectorOperation('kb-1', 'connector-1', false, context)

    expect(mockRequireWorkspaceBillingAttributionHeader).toHaveBeenCalledWith(context.headers, {
      workspaceId: 'workspace-1',
    })
    expect(mocks.syncKnowledgeConnector.execute).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        connectorId: 'connector-1',
        assertedWorkspaceId: 'workspace-1',
        source: 'ui',
      }),
      request: { headers: context.headers },
    })
    expect(mocks.connectorSynced).toHaveBeenCalledOnce()
    expect(result.body).toEqual({ success: true, message: 'Sync triggered' })
  })
})
