/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockCheckKnowledgeBaseWriteAccess,
  mockDbChain,
  mockFetch,
  mockGenerateInternalToken,
  mockSerializeBillingAttributionHeader,
} = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  }
  return {
    mockAssertBillingAttributionSnapshot: vi.fn(),
    mockCheckKnowledgeBaseWriteAccess: vi.fn(),
    mockDbChain: chain,
    mockFetch: vi.fn(),
    mockGenerateInternalToken: vi.fn(),
    mockSerializeBillingAttributionHeader: vi.fn(),
  }
})

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@sim/db/schema', () => ({
  knowledgeConnector: {
    id: 'knowledgeConnector.id',
    knowledgeBaseId: 'knowledgeConnector.knowledgeBaseId',
    archivedAt: 'knowledgeConnector.archivedAt',
    deletedAt: 'knowledgeConnector.deletedAt',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))
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
  handleTagAndVectorSearch: vi.fn(),
  handleVectorOnlySearch: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { updateDocument } from '@/lib/knowledge/documents/service'
import { generateSearchEmbedding, recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getDocumentTagDefinitions, getTagUsageStats } from '@/lib/knowledge/tags/service'
import {
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleVectorOnlySearch,
} from '@/app/api/knowledge/search/utils'
import { checkDocumentWriteAccess, checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

const mockCheckAttributedUsageLimits = vi.mocked(checkAttributedUsageLimits)
const mockCheckDocumentWriteAccess = vi.mocked(checkDocumentWriteAccess)
const mockCheckKnowledgeBaseAccess = vi.mocked(checkKnowledgeBaseAccess)
const mockGenerateSearchEmbedding = vi.mocked(generateSearchEmbedding)
const mockGetDocumentTagDefinitions = vi.mocked(getDocumentTagDefinitions)
const mockGetKnowledgeBaseById = vi.mocked(getKnowledgeBaseById)
const mockGetQueryStrategy = vi.mocked(getQueryStrategy)
const mockGetTagUsageStats = vi.mocked(getTagUsageStats)
const mockHandleTagAndVectorSearch = vi.mocked(handleTagAndVectorSearch)
const mockHandleVectorOnlySearch = vi.mocked(handleVectorOnlySearch)
const mockRecordSearchEmbeddingUsage = vi.mocked(recordSearchEmbeddingUsage)
const mockUpdateDocument = vi.mocked(updateDocument)

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

describe('knowledge base Copilot operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.limit.mockResolvedValue([{ knowledgeBaseId: 'knowledge-base-1' }])
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

  it('persists document tags by resolving display names to storage slots', async () => {
    mockCheckDocumentWriteAccess.mockResolvedValue({ hasAccess: true } as never)
    mockGetDocumentTagDefinitions.mockResolvedValue([
      {
        id: 'tag-definition-1',
        knowledgeBaseId: 'knowledge-base-1',
        tagSlot: 'tag1',
        displayName: 'identity_key',
        fieldType: 'text',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ])
    mockUpdateDocument.mockResolvedValue({} as never)

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_document',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          documentId: 'document-1',
          documentTags: [
            {
              tagName: 'identity_key',
              tagValue: 'dana@example.com',
            },
          ],
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-paid' }
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        documentId: 'document-1',
        tags: { identity_key: 'dana@example.com' },
      },
    })
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'document-1',
      { tag1: 'dana@example.com' },
      expect.any(String)
    )
  })

  it.each([
    ['an empty array', []],
    ['null', null],
    ['only blank entries', [{ tagName: ' ', tagValue: ' ' }]],
  ])('applies other document updates when documentTags contains %s', async (_label, tags) => {
    mockCheckDocumentWriteAccess.mockResolvedValue({ hasAccess: true } as never)
    mockUpdateDocument.mockResolvedValue({} as never)

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_document',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          documentId: 'document-1',
          filename: 'renamed.txt',
          enabled: false,
          documentTags: tags,
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-paid' }
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        documentId: 'document-1',
        filename: 'renamed.txt',
        enabled: false,
      },
    })
    expect(mockGetDocumentTagDefinitions).not.toHaveBeenCalled()
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'document-1',
      { filename: 'renamed.txt', enabled: false },
      expect.any(String)
    )
  })

  it('rejects update_document when empty documentTags is the only supplied update', async () => {
    mockCheckDocumentWriteAccess.mockResolvedValue({ hasAccess: true } as never)

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_document',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          documentId: 'document-1',
          documentTags: [],
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-paid' }
    )

    expect(result).toEqual({
      success: false,
      message: 'At least one of filename, enabled, or documentTags is required for update_document',
    })
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })

  it('applies tag filters to semantic queries', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true } as never)
    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'User Memory',
      workspaceId: 'workspace-paid',
      embeddingModel: 'text-embedding-3-small',
    } as never)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false } as never)
    mockGenerateSearchEmbedding.mockResolvedValue({
      embedding: [0.1, 0.2],
      isBYOK: false,
    } as never)
    mockGetQueryStrategy.mockReturnValue({ distanceThreshold: 1 } as never)
    mockGetDocumentTagDefinitions.mockResolvedValue([
      {
        id: 'tag-definition-1',
        knowledgeBaseId: 'knowledge-base-1',
        tagSlot: 'tag1',
        displayName: 'identity_key',
        fieldType: 'text',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ])
    mockHandleTagAndVectorSearch.mockResolvedValue([
      {
        documentId: 'document-1',
        content: 'Dana memory',
        chunkIndex: 0,
        distance: 0.1,
      } as never,
    ])
    mockRecordSearchEmbeddingUsage.mockResolvedValue(undefined)

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          query: 'memory',
          tagFilters: [{ tagName: 'identity_key', tagValue: 'dana@example.com' }],
        },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
      }
    )

    expect(result.success).toBe(true)
    expect(mockHandleTagAndVectorSearch).toHaveBeenCalledWith({
      knowledgeBaseIds: ['knowledge-base-1'],
      topK: 5,
      structuredFilters: [
        {
          tagSlot: 'tag1',
          fieldType: 'text',
          operator: 'eq',
          value: 'dana@example.com',
          valueTo: undefined,
        },
      ],
      queryVector: JSON.stringify([0.1, 0.2]),
      distanceThreshold: 1,
    })
    expect(mockHandleVectorOnlySearch).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty array', []],
    ['null', null],
    ['only blank entries', [{ tagName: ' ', tagValue: ' ' }]],
  ])('uses vector-only search when tagFilters contains %s', async (_label, filters) => {
    mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true } as never)
    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'User Memory',
      workspaceId: 'workspace-paid',
      embeddingModel: 'text-embedding-3-small',
    } as never)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false } as never)
    mockGenerateSearchEmbedding.mockResolvedValue({
      embedding: [0.1, 0.2],
      isBYOK: false,
    } as never)
    mockGetQueryStrategy.mockReturnValue({ distanceThreshold: 1 } as never)
    mockHandleVectorOnlySearch.mockResolvedValue([])
    mockRecordSearchEmbeddingUsage.mockResolvedValue(undefined)

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          query: 'memory',
          tagFilters: filters,
        },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
      }
    )

    expect(result.success).toBe(true)
    expect(mockGetDocumentTagDefinitions).not.toHaveBeenCalled()
    expect(mockHandleTagAndVectorSearch).not.toHaveBeenCalled()
    expect(mockHandleVectorOnlySearch).toHaveBeenCalledWith({
      knowledgeBaseIds: ['knowledge-base-1'],
      topK: 5,
      queryVector: JSON.stringify([0.1, 0.2]),
      distanceThreshold: 1,
    })
  })

  it('wraps tag definitions in an object-shaped result payload', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true } as never)
    mockGetDocumentTagDefinitions.mockResolvedValue([
      {
        id: 'tag-definition-1',
        knowledgeBaseId: 'knowledge-base-1',
        tagSlot: 'tag1',
        displayName: 'identity_key',
        fieldType: 'text',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ])

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'list_tags', args: { knowledgeBaseId: 'knowledge-base-1' } },
      { userId: 'user-1' }
    )

    expect(result.data).toEqual({
      tags: [
        {
          id: 'tag-definition-1',
          tagSlot: 'tag1',
          displayName: 'identity_key',
          fieldType: 'text',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
    })
  })

  it('wraps tag usage in an object-shaped result payload', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true } as never)
    mockGetTagUsageStats.mockResolvedValue([{ tagSlot: 'tag1', documentCount: 1 }] as never)

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'get_tag_usage', args: { knowledgeBaseId: 'knowledge-base-1' } },
      { userId: 'user-1' }
    )

    expect(result.data).toEqual({ usage: [{ tagSlot: 'tag1', documentCount: 1 }] })
  })
})
