/** @vitest-environment node */
import { db } from '@sim/db'
import {
  document,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const mocks = vi.hoisted(() => ({
  resolveStorage: vi.fn(),
  incrementStorage: vi.fn(),
  notifyStorage: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@/lib/billing/storage', () => ({
  resolveStorageBillingContext: mocks.resolveStorage,
  incrementAdmittedStorageUsageForBillingContextInTx: mocks.incrementStorage,
  maybeNotifyStorageLimitForBillingContext: mocks.notifyStorage,
}))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  revokeKnowledgeConnectorCredentialAccess: mocks.revoke,
}))
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  enqueueKnowledgeStorageCleanup: vi.fn(),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({ cleanupUnusedTagDefinitions: vi.fn() }))

import {
  detachKnowledgeConnector,
  enqueueConnectorDetachment,
  KNOWLEDGE_CONNECTOR_DETACH_EVENT,
} from '@/lib/knowledge/connectors/detachment'

const payload = {
  version: 1 as const,
  knowledgeBaseId: 'kb-1',
  connectorId: 'connector-1',
  detachedAt: '2026-09-22T12:00:00.000Z',
}
const owner = { workspaceId: 'ws-1' }
const STORAGE_CONTEXT = { workspaceId: 'ws-1', billedAccountUserId: 'user-1' }

function context(): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: KNOWLEDGE_CONNECTOR_DETACH_EVENT,
    attempts: 0,
    maxAttempts: 48,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function queueBatch(documentIds: string[]) {
  queueTableRows(knowledgeBase, [owner])
  queueTableRows(knowledgeConnector, [{ detachedAt: new Date(payload.detachedAt) }])
  queueTableRows(
    document,
    documentIds.map((id) => ({ id }))
  )
}

/** Row ids the projection release returns, in the order the handler updates the tables. */
function releaseProjectionRows(searchRows: number, keywordRows: number) {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `c-${index}` }))
  dbChainMockFns.returning
    .mockResolvedValueOnce(rows(searchRows))
    .mockResolvedValueOnce(rows(keywordRows))
}

function updatedTables() {
  return dbChainMockFns.update.mock.calls.map(([table]) => table)
}

describe('connector detachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveStorage.mockResolvedValue(STORAGE_CONTEXT)
    mocks.incrementStorage.mockResolvedValue(1_000)
    mocks.revoke.mockResolvedValue(undefined)
    queueTableRows(knowledgeBase, [owner])
  })
  afterEach(resetDbChainMock)

  it('enqueues a bounded immutable identity with a retry budget', async () => {
    await enqueueConnectorDetachment(db, payload)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: KNOWLEDGE_CONNECTOR_DETACH_EVENT,
        payload,
        maxAttempts: 48,
      })
    )
  })

  it('releases documents, bills them in the same transaction, then deletes the connector', async () => {
    queueBatch(['doc-1', 'doc-2'])
    releaseProjectionRows(3, 3)
    dbChainMockFns.returning.mockResolvedValueOnce([
      { fileSize: 10, deletedAt: null },
      { fileSize: 5, deletedAt: new Date('2026-09-01T00:00:00.000Z') },
    ])
    queueBatch([])

    await detachKnowledgeConnector(
      {
        ...payload,
        credentialAccess: { workspaceId: 'ws-1', credentialGroupId: 'g-1', actorUserId: 'u-1' },
      },
      context()
    )

    expect(updatedTables()).toEqual([embeddingSearch, embeddingKeywordTin, document])
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ connectorId: null })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: null, deletedAt: expect.anything() })
    )
    // The archived tombstone stays deleted, so only the live document is billed.
    expect(mocks.incrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 10)
    expect(mocks.notifyStorage).toHaveBeenCalledWith(STORAGE_CONTEXT, 1_000)
    expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual([knowledgeConnector])
    expect(mocks.revoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'g-1', connectorId: 'connector-1' },
      'u-1'
    )
  })

  it('keeps documents attached until their search rows fit one page, without spending retries', async () => {
    for (let batch = 0; batch < 4; batch++) {
      queueBatch(['doc-1'])
      releaseProjectionRows(250, 0)
    }

    expect(await detachKnowledgeConnector(payload, context())).toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(4)
    expect(updatedTables()).not.toContain(document)
    expect(mocks.incrementStorage).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('flips a large document once the rest of its search rows fit', async () => {
    queueBatch(['doc-1'])
    releaseProjectionRows(250, 12)
    queueBatch(['doc-1'])
    releaseProjectionRows(40, 12)
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileSize: 7, deletedAt: null }])
    queueBatch([])

    await detachKnowledgeConnector(payload, context())

    expect(updatedTables()).toEqual([
      embeddingSearch,
      embeddingKeywordTin,
      embeddingSearch,
      embeddingKeywordTin,
      document,
    ])
    expect(mocks.incrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 7)
    expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual([knowledgeConnector])
  })

  it.each([null, new Date('2026-09-21T12:00:00.000Z')])(
    'leaves a connector with a different detachment generation untouched: %s',
    async (detachedAt) => {
      queueTableRows(knowledgeBase, [owner])
      queueTableRows(knowledgeConnector, [{ detachedAt }])
      await detachKnowledgeConnector(payload, context())
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(mocks.revoke).not.toHaveBeenCalled()
    }
  )

  it('rolls the page back when the storage ledger cannot be written', async () => {
    queueBatch(['doc-1'])
    releaseProjectionRows(1, 1)
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileSize: 10, deletedAt: null }])
    mocks.incrementStorage.mockRejectedValueOnce(new Error('Storage payer changed'))

    await expect(detachKnowledgeConnector(payload, context())).rejects.toThrow(
      'Storage payer changed'
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.notifyStorage).not.toHaveBeenCalled()
  })

  it('stops when the knowledge base is gone', async () => {
    resetDbChainMock()
    await detachKnowledgeConnector(payload, context())
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('does no work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      detachKnowledgeConnector(payload, { ...context(), signal: controller.signal })
    ).rejects.toThrow()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
