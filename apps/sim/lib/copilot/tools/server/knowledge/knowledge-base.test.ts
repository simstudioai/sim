/**
 * @vitest-environment node
 */
import { knowledgeConnector } from '@sim/db/schema'
import { loggerMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockCheckKnowledgeBaseWriteAccess,
  mockGetKnowledgeBaseById,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockImportKnowledgeSearchResultSecretProvenance,
  mockPerformCreateKnowledgeConnector,
  mockPerformDeleteKnowledgeBase,
  mockPerformDeleteKnowledgeConnector,
  mockPerformSyncKnowledgeConnector,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockGetKnowledgeBaseById: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockImportKnowledgeSearchResultSecretProvenance: vi.fn(),
  mockPerformCreateKnowledgeConnector: vi.fn(),
  mockPerformDeleteKnowledgeBase: vi.fn(),
  mockPerformDeleteKnowledgeConnector: vi.fn(),
  mockPerformSyncKnowledgeConnector: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  checkAttributedUsageLimits: vi.fn(),
}))
vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  KnowledgeBase: { id: 'knowledge_base' },
}))
vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  assertServerToolNotAborted: vi.fn(),
}))
vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: vi.fn(),
  recordSearchEmbeddingUsage: vi.fn(),
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: vi.fn(),
}))
vi.mock('@/lib/knowledge/orchestration', () => ({
  performCreateKnowledgeBase: vi.fn(),
  performDeleteKnowledgeBase: mockPerformDeleteKnowledgeBase,
  performCreateKnowledgeConnector: mockPerformCreateKnowledgeConnector,
  performDeleteKnowledgeConnector: mockPerformDeleteKnowledgeConnector,
  performDeleteKnowledgeDocument: vi.fn(),
  performSyncKnowledgeConnector: mockPerformSyncKnowledgeConnector,
  performUpdateKnowledgeBase: vi.fn(),
  performUpdateKnowledgeConnector: vi.fn(),
  performUpdateKnowledgeDocument: vi.fn(),
  performUploadKnowledgeDocument: vi.fn(),
}))
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mockGetKnowledgeBaseById,
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
vi.mock('@/app/api/auth/oauth/utils', () => ({ getCredential: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mockGetBoundWorkspaceFileSecretProvenance,
}))
vi.mock('@/lib/knowledge/search/queries', () => ({
  executeKnowledgeSearch: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  knowledgeBaseServerTool,
  normalizeKnowledgeQueryTopK,
} from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { generateSearchEmbedding, recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import { executeKnowledgeSearch } from '@/lib/knowledge/search/queries'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
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

const CONTEXT = {
  userId: 'external-admin',
  workspaceId: 'workspace-paid',
  billingAttribution: BILLING_ATTRIBUTION,
}

describe('knowledge query result limit', () => {
  it.each([
    { input: undefined, expected: 5 },
    { input: 0, expected: 5 },
    { input: -1, expected: 5 },
    { input: 1.5, expected: 5 },
    { input: 12, expected: 12 },
    { input: 10_000, expected: 50 },
  ])('normalizes $input to $expected', ({ input, expected }) => {
    expect(normalizeKnowledgeQueryTopK(input)).toBe(expected)
  })
})

describe('knowledge base connector Copilot operations', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(knowledgeConnector, [{ knowledgeBaseId: 'knowledge-base-1' }])
    mockAssertBillingAttributionSnapshot.mockReturnValue(BILLING_ATTRIBUTION)
    mockCheckKnowledgeBaseWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: {
        id: 'knowledge-base-1',
        workspaceId: 'workspace-paid',
        name: 'Paid KB',
      },
    })
    mockPerformCreateKnowledgeConnector.mockResolvedValue({
      success: true,
      connector: { id: 'connector-1', connectorType: 'notion', status: 'active' },
    })
    mockPerformSyncKnowledgeConnector.mockResolvedValue({ success: true })
    mockPerformDeleteKnowledgeConnector.mockResolvedValue({
      success: true,
      documentsDeleted: 0,
      documentsKept: 3,
    })
  })

  it.each([
    {
      operation: 'add_connector',
      params: {
        operation: 'add_connector',
        args: {
          knowledgeBaseId: 'knowledge-base-1',
          connectorType: 'notion',
          apiKey: 'api-key',
        },
      },
      perform: mockPerformCreateKnowledgeConnector,
    },
    {
      operation: 'sync_connector',
      params: { operation: 'sync_connector', args: { connectorId: 'connector-1' } },
      perform: mockPerformSyncKnowledgeConnector,
    },
  ])('forwards immutable billing attribution for $operation', async ({ params, perform }) => {
    const result = await knowledgeBaseServerTool.execute(params, CONTEXT)

    expect(result.success).toBe(true)
    // The operation runs in-process now. The payer travels as a value on the
    // orchestration call rather than as a serialized header on an internal
    // HTTP self-call back into this same process.
    const call = perform.mock.calls[0][0]
    expect(await call.resolveBillingAttribution()).toEqual(BILLING_ATTRIBUTION)
    expect(call.source).toBe('agent')
    expect(mockAssertBillingAttributionSnapshot).toHaveBeenCalledWith(BILLING_ATTRIBUTION)
  })

  it('reports a failed knowledge base delete as failed, not as missing', async () => {
    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'Paid KB',
      workspaceId: 'workspace-paid',
    })
    mockPerformDeleteKnowledgeBase.mockResolvedValue({
      success: false,
      error: 'Knowledge base is locked',
      errorCode: 'conflict',
    })

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete', args: { knowledgeBaseId: 'knowledge-base-1' } },
      CONTEXT
    )

    // A knowledge base that exists but could not be archived is neither deleted
    // nor missing — folding it into notFound told the user it was never there.
    expect(result.data.notFound).toEqual([])
    expect(result.data.failed).toEqual([
      { id: 'knowledge-base-1', name: 'Paid KB', reason: 'Knowledge base is locked' },
    ])
    expect(result.message).toContain('Knowledge base is locked')
  })

  it('never relays an unclassified fault to the agent verbatim', async () => {
    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'Paid KB',
      workspaceId: 'workspace-paid',
    })
    mockPerformDeleteKnowledgeBase.mockResolvedValue({
      success: false,
      error: 'select "id" from "knowledge_base" — connection terminated',
      errorCode: 'internal',
    })

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete', args: { knowledgeBaseId: 'knowledge-base-1' } },
      CONTEXT
    )

    expect(result.data.failed[0].reason).toBe('Failed to delete knowledge base')
    expect(result.message).not.toContain('connection terminated')
  })

  it('reports that a deleted connector kept its documents, because it did', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete_connector', args: { connectorId: 'connector-1' } },
      CONTEXT
    )

    // The old wording claimed the documents "have been removed". They never
    // were: the tool reached the route over HTTP with no query string, so the
    // route's keep-documents default always applied.
    expect(result.success).toBe(true)
    expect(result.message).toContain('3 document(s) were kept')
    expect(result.message).not.toContain('removed')
    expect(mockPerformDeleteKnowledgeConnector).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'connector-1', source: 'agent' })
    )
  })
})

describe('knowledge base query model boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockImportKnowledgeSearchResultSecretProvenance.mockResolvedValue({
      imported: true,
      documentMetadata: {},
    })
    vi.mocked(recordSearchEmbeddingUsage).mockResolvedValue(undefined)
    mockImportKnowledgeSearchResultSecretProvenance.mockResolvedValue({
      imported: true,
      documentMetadata: {},
    })
  })

  it('projects the query at embedding, search, and usage boundaries', async () => {
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
      '{{KB_QUERY}}',
      'text-embedding-3-small',
      'workspace-paid'
    )
    expect(executeKnowledgeSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: '{{KB_QUERY}}' })
    )
    expect(recordSearchEmbeddingUsage).toHaveBeenCalledWith(
      expect.objectContaining({ query: '{{KB_QUERY}}' })
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
    mockImportKnowledgeSearchResultSecretProvenance.mockImplementationOnce(
      async ({ registry: resultRegistry }) => {
        expect(resultRegistry.recordResolved('STORED_TOKEN', 'stored-secret-value')).toBe(true)
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

  function addFile(
    context: Parameters<typeof knowledgeBaseServerTool.execute>[1] = {
      userId: 'external-admin',
      workspaceId: 'workspace-paid',
      billingAttribution: BILLING_ATTRIBUTION,
    }
  ) {
    return knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: 'knowledge-base-1', filePaths: ['files/report.pdf'] },
      },
      context
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

  it('keeps billing on the retained actor when authorization uses the workspace-key owner', async () => {
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({
      isExceeded: false,
    } as Awaited<ReturnType<typeof checkAttributedUsageLimits>>)
    vi.mocked(resolveWorkspaceFileReference).mockResolvedValue(null)

    const result = await addFile({
      userId: 'workspace-key-owner',
      workspaceId: 'workspace-paid',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    expect(result.success).toBe(false)
    expect(checkAttributedUsageLimits).toHaveBeenCalledWith(BILLING_ATTRIBUTION)
  })
})

describe('knowledge base query billing identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAssertBillingAttributionSnapshot.mockReturnValue(BILLING_ATTRIBUTION)
    vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true })
    vi.mocked(getKnowledgeBaseById).mockResolvedValue({
      id: 'knowledge-base-1',
      name: 'Paid KB',
      workspaceId: 'workspace-paid',
      embeddingModel: 'text-embedding-3-small',
    } as Awaited<ReturnType<typeof getKnowledgeBaseById>>)
    vi.mocked(checkAttributedUsageLimits).mockResolvedValue({ isExceeded: false } as Awaited<
      ReturnType<typeof checkAttributedUsageLimits>
    >)
    vi.mocked(generateSearchEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2],
      isBYOK: false,
    })
    vi.mocked(executeKnowledgeSearch).mockResolvedValue([])
  })

  it('authorizes as the key owner but meters the frozen workspace billing actor', async () => {
    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: { knowledgeBaseId: 'knowledge-base-1', query: 'refund policy' },
      },
      {
        userId: 'workspace-key-owner',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      }
    )

    expect(result.success).toBe(true)
    expect(checkKnowledgeBaseAccess).toHaveBeenCalledWith(
      'knowledge-base-1',
      'workspace-key-owner',
      'workspace-paid'
    )
    expect(recordSearchEmbeddingUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'external-admin',
        workspaceId: 'workspace-paid',
        billingAttribution: BILLING_ATTRIBUTION,
      })
    )
  })
})
