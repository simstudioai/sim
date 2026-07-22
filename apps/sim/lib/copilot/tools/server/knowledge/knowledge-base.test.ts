/**
 * @vitest-environment node
 */
import { knowledgeConnector } from '@sim/db/schema'
import { dbChainMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockCheckKnowledgeBaseWriteAccess,
  mockFetch,
  mockGenerateInternalToken,
  mockSerializeBillingAttributionHeader,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockFetch: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mockGenerateInternalToken,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  BILLING_ATTRIBUTION_HEADER: 'x-sim-billing-attribution',
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  checkAttributedUsageLimits: vi.fn(),
  serializeBillingAttributionHeader: mockSerializeBillingAttributionHeader,
}))
vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  KnowledgeBase: { id: 'knowledge_base' },
}))
vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  assertServerToolNotAborted: vi.fn(),
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getInternalApiBaseUrl: vi.fn(() => 'http://internal.test'),
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: vi.fn(),
  deleteDocument: vi.fn(),
  processDocumentAsync: vi.fn(),
  updateDocument: vi.fn(),
}))
vi.mock('@/lib/knowledge/embeddings', () => ({
  EMBEDDING_DIMENSIONS: 1536,
  generateSearchEmbedding: vi.fn(),
  getConfiguredEmbeddingModel: vi.fn(),
  recordSearchEmbeddingUsage: vi.fn(),
}))
vi.mock('@/lib/knowledge/service', () => ({
  createKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  getKnowledgeBaseById: vi.fn(),
  updateKnowledgeBase: vi.fn(),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  createTagDefinition: vi.fn(),
  deleteTagDefinition: vi.fn(),
  getDocumentTagDefinitions: vi.fn(),
  getNextAvailableSlot: vi.fn(),
  getTagDefinitionById: vi.fn(),
  getTagUsageStats: vi.fn(),
  updateTagDefinition: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: vi.fn(),
}))
vi.mock('@/app/api/knowledge/search/utils', () => ({
  getQueryStrategy: vi.fn(),
  handleVectorOnlySearch: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-paid',
  organizationId: 'organization-paid',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'organization-paid' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('knowledge base connector Copilot operations', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', mockFetch)
    queueTableRows(knowledgeConnector, [{ knowledgeBaseId: 'knowledge-base-1' }])
    mockAssertBillingAttributionSnapshot.mockReturnValue(BILLING_ATTRIBUTION)
    mockSerializeBillingAttributionHeader.mockReturnValue('serialized-attribution')
    mockGenerateInternalToken.mockResolvedValue('internal-token')
    mockCheckKnowledgeBaseWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: {
        id: 'knowledge-base-1',
        workspaceId: 'workspace-paid',
        name: 'Paid KB',
      },
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'connector-1',
          connectorType: 'notion',
          status: 'active',
        },
      }),
    })
  })

  it.each([
    {
      params: {
        operation: 'add_connector',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          connectorType: 'notion',
          apiKey: 'api-key',
        },
      },
      expectedPath: '/api/knowledge/knowledge-base-1/connectors',
    },
    {
      params: {
        operation: 'sync_connector',
        args: { connectorId: 'connector-1' },
      },
      expectedPath: '/api/knowledge/knowledge-base-1/connectors/connector-1/sync',
    },
  ])(
    'forwards immutable billing attribution for $params.operation',
    async ({ params, expectedPath }) => {
      const result = await knowledgeBaseServerTool.execute(params, {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
      })

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        `http://internal.test${expectedPath}`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer internal-token',
            'x-sim-billing-attribution': 'serialized-attribution',
          }),
        })
      )
      expect(mockSerializeBillingAttributionHeader).toHaveBeenCalledWith(BILLING_ATTRIBUTION)
    }
  )
})
