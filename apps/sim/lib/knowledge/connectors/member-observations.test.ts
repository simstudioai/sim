/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({
  ConnectorSyncDeletionGuardError: class ConnectorSyncDeletionGuardError extends Error {},
  hardDeleteDocuments: vi.fn(),
}))

import { db } from '@sim/db'
import {
  applyMemberDocumentLifecycle,
  removeUnseenMemberObservations,
  rewriteConnectorAcls,
  staleMemberWindowMs,
  sweepStaleMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import { MEMBER_OBSERVATION_STALE_AFTER_HOURS } from '@/lib/knowledge/connectors/sync-limits'
import { SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
import {
  ConnectorSyncDeletionGuardError,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'

const NOW = new Date('2026-09-01T12:00:00Z')
const STALE_MEMBER = { id: 'm-1', connectorId: 'c-1', syncIntervalMinutes: 60 }

describe('removeUnseenMemberObservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  it('rematerializes bounded batches before reading more absent observations', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ documentId: `d-${i}` })))
      .mockResolvedValueOnce([{ documentId: 'last' }])
      .mockResolvedValueOnce([])
    const onRemoved = vi.fn(async (_ids: string[]) => undefined)
    await expect(
      removeUnseenMemberObservations(db, 'member', 'generation', onRemoved)
    ).resolves.toEqual({ removed: 500, finished: false })
    await expect(
      removeUnseenMemberObservations(db, 'member', 'generation', onRemoved)
    ).resolves.toEqual({ removed: 1, finished: true })
    expect(onRemoved.mock.calls.map(([ids]) => (ids as string[]).length)).toEqual([500, 1])
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(500)
    expect(onRemoved.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[1]
    )
  })
})

describe('staleMemberWindowMs', () => {
  it('is the larger of a day and two intervals', () => {
    const day = MEMBER_OBSERVATION_STALE_AFTER_HOURS * 60 * 60 * 1000
    expect(staleMemberWindowMs(60)).toBe(day)
    expect(staleMemberWindowMs(0)).toBe(day)
    expect(staleMemberWindowMs(24 * 60)).toBe(2 * 24 * 60 * 60 * 1000)
  })
})

describe('sweepStaleMemberObservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('sweeps a member that is still stale once its row is locked', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ documentId: 'd-1' }, { documentId: 'd-2' }])
      .mockResolvedValueOnce([{ id: 'd-1' }, { id: 'd-2' }])
      .mockResolvedValueOnce([{ id: 'd-2' }])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 1,
      observationsRemoved: 2,
      documentsRematerialized: 2,
      docsTombstoned: 1,
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(1, 'share')
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(2, 'update')
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.knowledgeDocumentObservation)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({ deletedAt: NOW })
  })

  /**
   * A run that claimed the member between the selection and the lock moved
   * `lastStartedAt` forward, so the re-check under `FOR UPDATE` finds nothing
   * and the observations that run is about to write are left alone.
   */
  it('leaves a member that a run claimed after it was selected', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeConnectorMember, [])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 0,
      observationsRemoved: 0,
      documentsRematerialized: 0,
      docsTombstoned: 0,
    })

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  /** A connector that left members mode after the selection no longer matches the shared lock's re-check. */
  it('leaves a connector that left members mode after it was selected', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toMatchObject({ members: 0 })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.for).not.toHaveBeenCalledWith('update')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})

describe('rewriteConnectorAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('proves the lease inside each batch transaction before rewriting', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'd-1' }])

    await expect(
      rewriteConnectorAcls('c-1', [], { lease: { stillHeld: () => 'held' as never } })
    ).resolves.toBe(true)

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
  })

  it('stops without writing once the lease is gone', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(
      rewriteConnectorAcls('c-1', [], { lease: { stillHeld: () => 'lost' as never } })
    ).rejects.toBeInstanceOf(SyncLockLostException)

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('applyMemberDocumentLifecycle', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.mocked(hardDeleteDocuments).mockReset()
  })

  it('tombstones in bounded transactions and leaves remaining work for the next run', async () => {
    const batch = Array.from({ length: 500 }, (_, i) => ({ id: `document-${i}` }))
    dbChainMockFns.returning.mockResolvedValueOnce(batch)
    const input: Parameters<typeof applyMemberDocumentLifecycle>[0] = {
      connectorId: 'c-1',
      knowledgeBaseId: 'kb-1',
      runId: 'run-1',
      deadlineAt: Date.now() + 60_000,
      allowRemoval: true,
      lease: { beatIfDue: async () => {} },
      withLease: async (fn) => {
        const value = await fn(db)
        input.deadlineAt = Date.now() - 1
        return value
      },
    }
    expect(await applyMemberDocumentLifecycle(input)).toEqual({
      tombstoned: 500,
      resurrected: 0,
      purged: 0,
      finished: false,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(500)
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'remaining' }]).mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [])
    expect(
      await applyMemberDocumentLifecycle({ ...input, deadlineAt: Date.now() + 60_000 })
    ).toEqual({
      tombstoned: 1,
      resurrected: 0,
      purged: 0,
      finished: true,
    })
  })

  it('reports a reclaimed lease during a purge batch as the run being superseded', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [{ id: 'd-1' }])
    vi.mocked(hardDeleteDocuments).mockRejectedValueOnce(
      new ConnectorSyncDeletionGuardError('lease reclaimed')
    )

    await expect(
      applyMemberDocumentLifecycle({
        connectorId: 'c-1',
        knowledgeBaseId: 'kb-1',
        runId: 'run-1',
        withLease: (fn) => fn(db as never),
        deadlineAt: Date.now() + 60_000,
        allowRemoval: true,
        lease: { beatIfDue: async () => {} } as never,
      })
    ).rejects.toBeInstanceOf(SyncLockLostException)
  })
})
