/** @vitest-environment node */
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const mocks = vi.hoisted(() => ({ storage: vi.fn(), tags: vi.fn(), revoke: vi.fn() }))
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  enqueueKnowledgeStorageCleanup: mocks.storage,
}))
vi.mock('@/lib/knowledge/tags/service', () => ({ cleanupUnusedTagDefinitions: mocks.tags }))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  revokeKnowledgeConnectorCredentialAccess: mocks.revoke,
}))

import {
  cleanupKnowledgeConnector,
  enqueueConnectorDeletion,
  KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
} from '@/lib/knowledge/connectors/deletion'

const payload = {
  version: 1 as const,
  knowledgeBaseId: 'kb-1',
  connectorId: 'connector-1',
  deletedAt: '2026-09-15T12:00:00.000Z',
  credentialAccess: { workspaceId: 'ws-1', credentialGroupId: 'group-1', actorUserId: 'user-1' },
}
const owner = { workspaceId: 'ws-1', organizationId: null, userId: 'user-1' }

function context(): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 48,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function queueBatch(docs: { id: string; fileUrl: string }[], chunks: { id: string }[] = []) {
  queueTableRows(knowledgeBase, [owner])
  queueTableRows(knowledgeConnector, [{ deletedAt: new Date(payload.deletedAt) }])
  queueTableRows(document, docs)
  if (docs.length) queueTableRows(embedding, chunks)
}

describe('durable connector cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.storage.mockResolvedValue([])
    mocks.tags.mockResolvedValue(0)
    mocks.revoke.mockResolvedValue(undefined)
  })
  afterEach(resetDbChainMock)

  it('enqueues a bounded immutable identity with a retry budget', async () => {
    await enqueueConnectorDeletion(db, payload)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
        payload,
        maxAttempts: 48,
      })
    )
  })

  it('preserves storage cleanup intent before removing documents and then the connector', async () => {
    const docs = [{ id: 'doc-1', fileUrl: '/file.txt' }]
    queueBatch(docs)
    queueBatch([])
    await cleanupKnowledgeConnector(payload, context())
    expect(mocks.storage).toHaveBeenCalledWith(
      expect.anything(),
      [{ ...docs[0], ...owner }],
      'event-1'
    )
    expect(mocks.storage.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual([
      document,
      knowledgeConnector,
    ])
    expect(mocks.revoke).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        credentialGroupId: 'group-1',
        connectorId: 'connector-1',
      },
      'user-1'
    )
    expect(mocks.tags).toHaveBeenCalledOnce()
  })

  it('yields after four bounded chunk batches without spending the failure retry budget', async () => {
    const docs = Array.from({ length: 250 }, (_, index) => ({ id: `doc-${index}`, fileUrl: '' }))
    const chunks = Array.from({ length: 1000 }, (_, index) => ({ id: `chunk-${index}` }))
    for (let batch = 0; batch < 4; batch++) queueBatch(docs, chunks)
    expect(await cleanupKnowledgeConnector(payload, context())).toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(4)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(250)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1000)
    expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual(
      Array(4).fill(embedding)
    )
    expect(mocks.storage).not.toHaveBeenCalled()
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('keeps the documents when storage cleanup intent cannot be persisted', async () => {
    queueBatch([{ id: 'doc-1', fileUrl: '/file.txt' }])
    mocks.storage.mockRejectedValueOnce(new Error('Outbox unavailable'))
    await expect(cleanupKnowledgeConnector(payload, context())).rejects.toThrow(
      'Outbox unavailable'
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.tags).not.toHaveBeenCalled()
  })

  it.each([knowledgeConnectorSyncLog, knowledgeConnectorMemberSyncLog, knowledgeConnectorMember])(
    'drains related rows before deleting their connector',
    async (table) => {
      const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `row-${index}` }))
      for (let batch = 0; batch < 4; batch++) {
        queueBatch([])
        queueTableRows(table, rows)
      }
      expect(await cleanupKnowledgeConnector(payload, context())).toMatchObject({
        outcome: 'deferred',
        consumeAttempt: false,
      })
      expect(dbChainMockFns.delete.mock.calls.map(([target]) => target)).toEqual(
        Array(4).fill(table)
      )
      expect(mocks.revoke).not.toHaveBeenCalled()
      expect(mocks.tags).not.toHaveBeenCalled()
    }
  )

  it.each([null, new Date('2026-09-14T12:00:00.000Z')])(
    'leaves a connector with a different deletion generation untouched: %s',
    async (deletedAt) => {
      queueTableRows(knowledgeBase, [owner])
      queueTableRows(knowledgeConnector, [{ deletedAt }])
      await cleanupKnowledgeConnector(payload, context())
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(mocks.storage).not.toHaveBeenCalled()
      expect(mocks.revoke).not.toHaveBeenCalled()
    }
  )

  it('retries final effects after the connector deletion already committed', async () => {
    queueBatch([])
    mocks.tags.mockRejectedValueOnce(new Error('Temporary tag failure'))
    await expect(cleanupKnowledgeConnector(payload, context())).rejects.toThrow(
      'Temporary tag failure'
    )
    resetDbChainMock()
    queueTableRows(knowledgeBase, [owner])
    queueTableRows(knowledgeConnector, [])
    await cleanupKnowledgeConnector(payload, context())
    expect(mocks.tags).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('does no work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      cleanupKnowledgeConnector(payload, { ...context(), signal: controller.signal })
    ).rejects.toThrow()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
