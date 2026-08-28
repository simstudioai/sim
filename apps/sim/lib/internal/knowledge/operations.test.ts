/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireWorkspaceBillingAttributionHeader: vi.fn(),
  listKnowledgeTags: { execute: vi.fn() },
  syncKnowledgeConnector: { execute: vi.fn() },
  connectorSynced: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireWorkspaceBillingAttributionHeader: mocks.requireWorkspaceBillingAttributionHeader,
}))

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

vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: mocks.listKnowledgeTags,
}))

vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  prepareKnowledgeModelInputProvenance: vi.fn(),
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: vi.fn(),
}))

import {
  type KnowledgeOperationContext,
  listTagsOperation,
  syncConnectorOperation,
} from '@/lib/internal/knowledge/operations'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'trusted-user',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:knowledge',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution' as const, workflowId: 'workflow-1' },
}

function createContext(): KnowledgeOperationContext {
  return { principal, headers: new Headers({ 'x-billing': 'snapshot' }) }
}

describe('Knowledge direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the canonical tag use case with principal workspace assertion', async () => {
    const tag = {
      id: 'tag-1',
      tagSlot: 'tag1',
      displayName: 'Team',
      fieldType: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.listKnowledgeTags.execute.mockResolvedValue({ tagDefinitions: [tag] })
    const context = createContext()

    const result = await listTagsOperation('kb-1', context)

    expect(mocks.listKnowledgeTags.execute).toHaveBeenCalledWith({
      principal,
      input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: 'workspace-1' },
      request: { headers: context.headers },
    })
    expect(result.body).toEqual({ success: true, data: [tag] })
  })

  it('restores exact billing attribution before the canonical connector sync use case', async () => {
    const attribution = { actorUserId: 'trusted-user', workspaceId: 'workspace-1' }
    mocks.requireWorkspaceBillingAttributionHeader.mockReturnValue(attribution)
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

    expect(mocks.requireWorkspaceBillingAttributionHeader).toHaveBeenCalledWith(context.headers, {
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
