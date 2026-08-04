/**
 * @vitest-environment node
 */
import { knowledgeConnector } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockCheckKnowledgeBaseWriteAccess,
  mockGetKnowledgeBaseById,
  mockPerformCreateKnowledgeConnector,
  mockPerformDeleteKnowledgeBase,
  mockPerformDeleteKnowledgeConnector,
  mockPerformSyncKnowledgeConnector,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockGetKnowledgeBaseById: vi.fn(),
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
vi.mock('@/app/api/knowledge/search/utils', () => ({
  executeKnowledgeSearch: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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
})
