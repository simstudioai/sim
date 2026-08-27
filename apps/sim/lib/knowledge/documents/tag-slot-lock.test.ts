/**
 * @vitest-environment node
 *
 * Structural guard for the tag-slot check in `updateDocument`.
 *
 * The property under test is not an interleaving — a real race cannot be
 * reproduced against a mocked driver — but the shape that makes the
 * interleaving impossible: the check must run inside the write's transaction,
 * after the knowledge-base row lock tag deletion also takes, and before the
 * document row is written. Read outside that lock it is check-then-act, and a
 * tag deletion committing in between strands a value in a slot no definition
 * covers.
 *
 * The shared drizzle mock hands the transaction callback the same client as
 * `db`, so "ran against the transaction" cannot be asserted by identity; call
 * ordering relative to `db.transaction` is what pins it.
 */
import { document, knowledgeBase, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyStorageUsageDeltasInTx,
  mockCheckStorageQuota,
  mockCheckStorageQuotaForBillingContext,
  mockDecrementStorageUsageForBillingContextInTx,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
  mockGetFileMetadataByKeys,
  mockEnqueueKnowledgeDocumentProcessing,
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockEnqueueKnowledgeDocumentProcessing: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: mockApplyStorageUsageDeltasInTx,
  checkStorageQuota: mockCheckStorageQuota,
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: vi.fn(),
  getFileMetadataByKeys: mockGetFileMetadataByKeys,
}))

vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: mockEnqueueKnowledgeDocumentProcessing,
}))

import { createSingleDocument, updateDocument } from '@/lib/knowledge/documents/service'

const KNOWLEDGE_BASE_ID = 'kb-1'
const NOW = new Date('2026-01-01T00:00:00.000Z')

/** invocationCallOrder of the first call to `spy` whose first argument is `table`. */
function orderForTable(
  spy: { mock: { calls: unknown[][]; invocationCallOrder: number[] } },
  table: unknown
): number {
  for (let i = 0; i < spy.mock.calls.length; i++) {
    if (spy.mock.calls[i][0] === table) return spy.mock.invocationCallOrder[i]
  }
  return -1
}

function definition(tagSlot: string, displayName: string) {
  return {
    id: `tag-def-${tagSlot}`,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    tagSlot,
    displayName,
    fieldType: 'text',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('updateDocument tag-slot validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(document, [
      { id: 'doc-1', knowledgeBaseId: KNOWLEDGE_BASE_ID, secretProvenanceVersion: null },
    ])
    dbChainMockFns.returning.mockResolvedValue([
      { id: 'doc-1', knowledgeBaseId: KNOWLEDGE_BASE_ID, secretProvenanceVersion: null },
    ])
  })

  it('checks the slot inside the write transaction, under the knowledge-base row lock, before writing', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await updateDocument('doc-1', { tag1: 'priority' }, 'req-1', {
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
    })

    const transactionOrder = dbChainMockFns.transaction.mock.invocationCallOrder[0]
    const lockOrder = dbChainMockFns.execute.mock.invocationCallOrder[0] ?? -1
    const definitionReadOrder = orderForTable(dbChainMockFns.from, knowledgeBaseTagDefinitions)
    const documentWriteOrder = orderForTable(dbChainMockFns.update, document)

    expect(transactionOrder).toBeGreaterThan(0)
    expect(lockOrder).toBeGreaterThan(transactionOrder)
    expect(definitionReadOrder).toBeGreaterThan(lockOrder)
    expect(documentWriteOrder).toBeGreaterThan(definitionReadOrder)
  })

  it('refuses a slot no definition covers, and writes neither the document nor its embeddings', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await expect(
      updateDocument('doc-1', { tag2: 'purple' }, 'req-1', {
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('takes no knowledge-base lock for an update that lands no tag value', async () => {
    await updateDocument('doc-1', { filename: 'renamed.txt' }, 'req-1', {
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
    })

    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    expect(orderForTable(dbChainMockFns.from, knowledgeBase)).toBe(-1)
    expect(orderForTable(dbChainMockFns.update, document)).toBeGreaterThan(0)
  })

  it('takes no knowledge-base lock when clearing a slot, so a stranded value stays erasable', async () => {
    await updateDocument('doc-1', { tag2: '' }, 'req-1', { knowledgeBaseId: KNOWLEDGE_BASE_ID })

    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    expect(orderForTable(dbChainMockFns.update, document)).toBeGreaterThan(0)
  })
})

describe('createSingleDocument tag-slot validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      { id: KNOWLEDGE_BASE_ID, workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      billedAccountUserId: 'workspace-owner',
      billingEntity: { type: 'organization' as const, id: 'workspace-org' },
      plan: 'team_25000',
      customStorageLimitGB: null,
    })
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(5)
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(undefined)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockEnqueueKnowledgeDocumentProcessing.mockResolvedValue('outbox-1')
  })

  const documentData = {
    filename: 'note.txt',
    fileUrl: 'data:text/plain;base64,SGVsbG8=',
    fileSize: 5,
    mimeType: 'text/plain',
  }

  it('checks the slot inside the insert transaction, under the knowledge-base row lock', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await createSingleDocument({ ...documentData, tag1: 'priority' }, KNOWLEDGE_BASE_ID, 'req-1')

    const transactionOrder = dbChainMockFns.transaction.mock.invocationCallOrder[0]
    const lockOrder = dbChainMockFns.execute.mock.invocationCallOrder[0] ?? -1
    const definitionReadOrder = orderForTable(dbChainMockFns.from, knowledgeBaseTagDefinitions)
    const documentInsertOrder = orderForTable(dbChainMockFns.insert, document)

    expect(transactionOrder).toBeGreaterThan(0)
    expect(lockOrder).toBeGreaterThan(transactionOrder)
    expect(definitionReadOrder).toBeGreaterThan(lockOrder)
    expect(documentInsertOrder).toBeGreaterThan(definitionReadOrder)
  })

  it('refuses a slot no definition covers, and inserts nothing', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await expect(
      createSingleDocument({ ...documentData, tag2: 'purple' }, KNOWLEDGE_BASE_ID, 'req-1')
    ).rejects.toMatchObject({ code: 'validation' })

    expect(orderForTable(dbChainMockFns.insert, document)).toBe(-1)
  })
})
