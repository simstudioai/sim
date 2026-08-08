/**
 * @vitest-environment node
 */
import { knowledgeConnector } from '@sim/db/schema'
import {
  encryptionMockFns,
  loggerMock,
  queueTableRows,
  resetDbChainMock,
  resetUrlsMock,
  urlsMockFns,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockCheckKnowledgeBaseWriteAccess,
  mockFetch,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockGenerateInternalToken,
  mockImportKnowledgeSearchResultSecretProvenance,
  mockSerializeBillingAttributionHeader,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockFetch: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
  mockImportKnowledgeSearchResultSecretProvenance: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
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
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
}))
vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  KnowledgeBase: { id: 'knowledge_base' },
}))
vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  assertServerToolNotAborted: vi.fn(),
}))
beforeAll(() => {
  urlsMockFns.mockGetInternalApiBaseUrl.mockReturnValue('http://internal.test')
})

afterAll(resetUrlsMock)
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
vi.mock('@/lib/knowledge/secret-provenance', () => ({
  importKnowledgeSearchResultSecretProvenance: mockImportKnowledgeSearchResultSecretProvenance,
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
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mockGetBoundWorkspaceFileSecretProvenance,
}))
vi.mock('@/app/api/knowledge/search/utils', () => ({
  executeKnowledgeSearch: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { generateSearchEmbedding, recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { executeKnowledgeSearch } from '@/app/api/knowledge/search/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const knowledgeLoggerIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'KnowledgeBaseServerTool'
)
const knowledgeLogger = loggerMock.createLogger.mock.results[knowledgeLoggerIndex]?.value

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
    encryptionMockFns.mockDecryptSecret.mockReset()
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

describe('knowledge base query model boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptionMockFns.mockDecryptSecret.mockReset()
    resetDbChainMock()
    vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true })
    vi.mocked(getKnowledgeBaseById).mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'Private KB',
      workspaceId: 'workspace-paid',
      embeddingModel: 'text-embedding-3-small',
    } as Awaited<ReturnType<typeof getKnowledgeBaseById>>)
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({ isExceeded: false })
    vi.mocked(generateSearchEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2],
      isBYOK: false,
    })
    vi.mocked(executeKnowledgeSearch).mockResolvedValue([])
    vi.mocked(recordSearchEmbeddingUsage).mockResolvedValue(undefined)
    mockImportKnowledgeSearchResultSecretProvenance.mockResolvedValue({
      imported: true,
      documentMetadata: {},
    })
  })

  it('preserves a query that merely collides with ambient secret plaintext', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'KB_QUERY',
        plaintext: 'private knowledge query',
        encryptedValue: 'encrypted-query',
      },
    ])
    registry.recordResolved('KB_QUERY', 'private knowledge query')

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          query: 'private knowledge query',
        },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(result.data?.query).toBe('private knowledge query')
    expect(generateSearchEmbedding).toHaveBeenCalledWith(
      'private knowledge query',
      'text-embedding-3-small',
      'workspace-paid'
    )
    expect(executeKnowledgeSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'private knowledge query' })
    )
    expect(recordSearchEmbeddingUsage).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'private knowledge query' })
    )
    expect(mockImportKnowledgeSearchResultSecretProvenance).toHaveBeenCalledWith({
      registry,
      results: [],
    })
    expect(knowledgeLogger).toBeDefined()
    expect(JSON.stringify(knowledgeLogger?.info.mock.calls)).not.toContain(
      'private knowledge query'
    )
  })

  it('imports exact persisted result provenance before the Copilot result is projected', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'STORED_TOKEN',
        plaintext: 'stored-secret-value',
        encryptedValue: 'encrypted-stored-secret',
      },
    ])
    const results = [
      {
        id: 'embedding-1',
        documentId: 'document-1',
        content: 'stored-secret-value',
        chunkIndex: 0,
        distance: 0.1,
      },
    ]
    vi.mocked(executeKnowledgeSearch).mockResolvedValue(results)
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'stored-secret-value' })
    mockImportKnowledgeSearchResultSecretProvenance.mockImplementationOnce(
      async ({ registry: resultRegistry }) => {
        expect(
          await resultRegistry.importProvenance(
            {
              version: 1,
              complete: true,
              entries: [{ name: 'STORED_TOKEN', encryptedValue: 'encrypted-stored-secret' }],
            },
            { trusted: true }
          )
        ).toBe(true)
        return { imported: true, documentMetadata: {} }
      }
    )

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          query: 'public query',
        },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(result.data?.results[0].content).toBe('stored-secret-value')
    expect(projectToolResultForCopilot({ success: true, output: result }, registry)).toMatchObject({
      success: true,
      output: {
        data: { results: [{ content: '{{STORED_TOKEN}}' }] },
      },
    })
  })

  it('fails closed when persisted result provenance cannot be established', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    vi.mocked(executeKnowledgeSearch).mockResolvedValue([
      {
        id: 'embedding-1',
        documentId: 'document-1',
        content: 'unclassified persisted content',
        chunkIndex: 0,
        distance: 0.1,
      },
    ])
    mockImportKnowledgeSearchResultSecretProvenance.mockResolvedValueOnce({
      imported: false,
      documentMetadata: {},
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          query: 'public query',
        },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result).toEqual({
      success: false,
      message: 'Failed to query knowledge base: Knowledge result secret provenance is unavailable',
    })
    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })
})

describe('knowledge base add_file usage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckKnowledgeBaseWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: { id: 'knowledge-base-1', workspaceId: 'workspace-paid', name: 'Paid KB' },
    })
    vi.mocked(getKnowledgeBaseById).mockResolvedValue({
      id: 'knowledge-base-1',
      workspaceId: 'workspace-paid',
    } as Awaited<ReturnType<typeof getKnowledgeBaseById>>)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [],
    })
  })

  function addFile() {
    return knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: 'knowledge-base-1', filePaths: ['files/report.pdf'] },
      },
      {
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
      }
    )
  }

  it('refuses to index when the payer is over its usage limit', async () => {
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded.',
    } as Awaited<ReturnType<typeof checkAttributedUsageLimits>>)

    const result = await addFile()

    expect(result.success).toBe(false)
    expect(result.message).toContain('Usage limit exceeded')
    // The gate must precede any indexing work, matching the upload routes.
    expect(resolveWorkspaceFileReference).not.toHaveBeenCalled()
    expect(createSingleDocument).not.toHaveBeenCalled()
  })

  it('gates on the knowledge base workspace payer, not the caller', async () => {
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({
      isExceeded: false,
    } as Awaited<ReturnType<typeof checkAttributedUsageLimits>>)
    vi.mocked(resolveWorkspaceFileReference).mockResolvedValue(null)

    await addFile()

    expect(checkAttributedUsageLimits).toHaveBeenCalledWith(BILLING_ATTRIBUTION)
  })

  it('does not index a workspace file containing resolved-secret provenance', async () => {
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({
      isExceeded: false,
    } as Awaited<ReturnType<typeof checkAttributedUsageLimits>>)
    vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
      id: 'file-1',
      key: 'workspace/workspace-paid/report.pdf',
      name: 'report.pdf',
      size: 100,
      type: 'application/pdf',
    } as Awaited<ReturnType<typeof resolveWorkspaceFileReference>>)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValueOnce({
      status: 'exact',
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
    })

    const result = await addFile()

    expect(result.success).toBe(false)
    expect(mockGetBoundWorkspaceFileSecretProvenance).toHaveBeenCalledWith('workspace-paid', {
      fileId: 'file-1',
      key: 'workspace/workspace-paid/report.pdf',
      context: 'workspace',
    })
    expect(createSingleDocument).not.toHaveBeenCalled()
  })
})
