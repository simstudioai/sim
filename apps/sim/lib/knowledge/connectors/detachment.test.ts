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
  decrementStorage: vi.fn(),
  notifyStorage: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@/lib/billing/storage', () => ({
  resolveStorageBillingContext: mocks.resolveStorage,
  incrementAdmittedStorageUsageForBillingContextInTx: mocks.incrementStorage,
  decrementStorageUsageForBillingContextInTx: mocks.decrementStorage,
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
  settleDetachedConnectorReservations,
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

function queueBatch(documentIds: string[], reservedBytes = 0) {
  queueTableRows(knowledgeBase, [owner])
  queueTableRows(knowledgeConnector, [{ detachedAt: new Date(payload.detachedAt), reservedBytes }])
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

  it('releases documents against the reservation, then settles what remains with the connector', async () => {
    queueBatch(['doc-1', 'doc-2'], 25)
    releaseProjectionRows(3, 3)
    dbChainMockFns.returning.mockResolvedValueOnce([
      { fileSize: 10, deletedAt: null },
      { fileSize: 5, deletedAt: new Date('2026-09-01T00:00:00.000Z') },
    ])
    // A kept document deleted before its release leaves part of the reservation unmatched.
    queueBatch([], 15)

    await detachKnowledgeConnector(
      {
        ...payload,
        credentialAccess: { workspaceId: 'ws-1', credentialGroupId: 'g-1', actorUserId: 'u-1' },
      },
      context()
    )

    expect(updatedTables()).toEqual([
      embeddingSearch,
      embeddingKeywordTin,
      document,
      knowledgeConnector,
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ connectorId: null })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: null, deletedAt: expect.anything() })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ detachReservedBytes: expect.anything() })
    expect(mocks.incrementStorage).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual([knowledgeConnector])
    expect(mocks.decrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 15)
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
      knowledgeConnector,
    ])
    expect(mocks.decrementStorage).not.toHaveBeenCalled()
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

  it('charges documents that grew past their reservation without refusing', async () => {
    queueBatch([], -4)

    await detachKnowledgeConnector(payload, context())

    expect(mocks.incrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 4)
    expect(mocks.notifyStorage).toHaveBeenCalledWith(STORAGE_CONTEXT, 1_000)
    expect(mocks.decrementStorage).not.toHaveBeenCalled()
  })

  it('fails the final transaction when the reservation cannot be settled', async () => {
    queueBatch([], 9)
    mocks.decrementStorage.mockRejectedValueOnce(new Error('Storage payer changed'))

    await expect(detachKnowledgeConnector(payload, context())).rejects.toThrow(
      'Storage payer changed'
    )
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('releases nothing and spends no attempt while the knowledge base is deleted', async () => {
    queueTableRows(knowledgeBase, [{ ...owner, deletedAt: new Date('2026-09-20T00:00:00.000Z') }])

    const result = await detachKnowledgeConnector(payload, context())

    expect(result).toMatchObject({ outcome: 'deferred', consumeAttempt: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.decrementStorage).not.toHaveBeenCalled()
    expect(mocks.revoke).not.toHaveBeenCalled()
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

describe('purged knowledge base reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveStorage.mockResolvedValue(STORAGE_CONTEXT)
    mocks.incrementStorage.mockResolvedValue(1_000)
    /** The base is read once to resolve its payer and again under the settlement lock. */
    queueTableRows(knowledgeBase, [owner])
    queueTableRows(knowledgeBase, [owner])
  })
  afterEach(resetDbChainMock)

  it('settles a base as one net refund, so no overdraft warning precedes it', async () => {
    queueTableRows(knowledgeConnector, [
      { id: 'connector-a', reservedBytes: -7 },
      { id: 'connector-b', reservedBytes: 50 },
    ])

    await settleDetachedConnectorReservations(['kb-1'], 'remaining')

    expect(mocks.decrementStorage).toHaveBeenCalledOnce()
    expect(mocks.decrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 43)
    expect(mocks.incrementStorage).not.toHaveBeenCalled()
    expect(mocks.notifyStorage).not.toHaveBeenCalled()
    /** Settlement zeroes the reservation and leaves the detach itself untouched. */
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ detachReservedBytes: 0 })
  })

  it('charges a net overdraft once and notifies with the final balance', async () => {
    queueTableRows(knowledgeConnector, [
      { id: 'connector-a', reservedBytes: -30 },
      { id: 'connector-b', reservedBytes: 10 },
    ])

    await settleDetachedConnectorReservations(['kb-1'], 'remaining')

    expect(mocks.incrementStorage).toHaveBeenCalledOnce()
    expect(mocks.incrementStorage).toHaveBeenCalledWith(expect.anything(), STORAGE_CONTEXT, 20)
    expect(mocks.decrementStorage).not.toHaveBeenCalled()
    expect(mocks.notifyStorage).toHaveBeenCalledWith(STORAGE_CONTEXT, 1_000)
  })
})
