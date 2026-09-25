import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({
  ConnectorSyncDeletionGuardError: class ConnectorSyncDeletionGuardError extends Error {},
  hardDeleteDocuments: vi.fn(),
}))

import { db } from '@sim/db'
import { inArray } from 'drizzle-orm'
import {
  applyMemberDocumentLifecycle,
  pagesByProjectionRows,
  rematerializeDocumentAcls,
  renewMemberObservationsInScopes,
  rewriteConnectorAcls,
  staleMemberWindowMs,
  sweepStaleMemberObservations,
  writeProjectionPages,
} from '@/lib/knowledge/connectors/member-observations'
import { MEMBER_OBSERVATION_STALE_AFTER_HOURS } from '@/lib/knowledge/connectors/sync-limits'
import { type LeaseTransaction, SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
import {
  ConnectorSyncDeletionGuardError,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'

const NOW = new Date('2026-09-01T12:00:00Z')
const STALE_MEMBER = { id: 'm-1', connectorId: 'c-1', syncIntervalMinutes: 60 }

describe('renewMemberObservationsInScopes', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  const renew = (scopePrefixes: string[], deadlineAt = Date.now() + 60_000) =>
    renewMemberObservationsInScopes({
      connectorId: 'connector',
      memberId: 'member',
      scopePrefixes,
      renewBefore: NOW,
      deadlineAt,
      beforeBatch: vi.fn(async () => undefined),
      withLease: (fn) => fn(db),
    })
  const renewedIds = () =>
    vi
      .mocked(inArray)
      .mock.calls.map(([, values]) => values as string[])
      .filter((values) => Array.isArray(values))

  it('matches every id under a broader scope that covers a narrower one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { documentId: 'd-1', externalId: 'slack:v4:T1:C1:1.0' },
      { documentId: 'd-2', externalId: 'slack:v4:T1:C2:1.0' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ documentId: 'd-1' }, { documentId: 'd-2' }])
    await renew(['slack:v4:T1:C2:', 'slack:v4:T1:'])
    expect(renewedIds()).toEqual([['d-1', 'd-2']])
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
    resetDbChainMock()
  })

  it('sweeps a member that is still stale once its row is locked', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
    queueTableRows(schemaMock.knowledgeDocumentObservation, [
      { documentId: 'd-1' },
      { documentId: 'd-2' },
    ])
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
    /** The member row first, then the page's documents, the connector row last. */
    expect(dbChainMockFns.for.mock.calls.map(([mode]) => mode)).toEqual([
      'update',
      'update',
      'share',
    ])
    expect(dbChainMockFns.for.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      dbChainMockFns.set.mock.invocationCallOrder.at(-1)!
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.knowledgeDocumentObservation)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({ deletedAt: NOW })
  })

  /** A connector whose running member page holds its row must not stall the other connectors. */
  it('defers a member whose page hits a lock timeout and still sweeps the next one', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [
      STALE_MEMBER,
      /** Another member of the busy connector waits a tick rather than wait out the same lock. */
      { ...STALE_MEMBER, id: 'm-3' },
      { ...STALE_MEMBER, id: 'm-2', connectorId: 'c-2' },
    ])
    dbChainMockFns.transaction.mockRejectedValueOnce(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-2' }])
    queueTableRows(schemaMock.knowledgeDocumentObservation, [{ documentId: 'd-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-2' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ documentId: 'd-1' }])
      .mockResolvedValueOnce([{ id: 'd-1' }])
      .mockResolvedValueOnce([])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 1,
      observationsRemoved: 1,
      documentsRematerialized: 1,
      docsTombstoned: 0,
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
  })

  it('fails the sweep on an error that is not a lock or capacity failure', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    dbChainMockFns.transaction.mockRejectedValueOnce(new TypeError('broken'))

    await expect(sweepStaleMemberObservations(NOW)).rejects.toThrow('broken')
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
})

describe('pagesByProjectionRows', () => {
  const doc = (id: string, chunkCount: number) => ({ id, chunkCount })

  it('fills a page up to the projection row cap and keeps order', () => {
    expect(
      pagesByProjectionRows([doc('a', 100), doc('b', 150), doc('c', 1), doc('d', 249)])
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('gives a document above the cap a page alone so it still makes progress', () => {
    expect(pagesByProjectionRows([doc('a', 1), doc('huge', 5_000), doc('b', 1)])).toEqual([
      ['a'],
      ['huge'],
      ['b'],
    ])
  })
})

describe('rematerializeDocumentAcls', () => {
  beforeEach(() => {
    resetDbChainMock()
  })
  const page = vi.fn()
  const transaction: LeaseTransaction = (write) => {
    page()
    return write(db)
  }

  it('opens no transaction for documents whose ACL already matches their observers', async () => {
    queueTableRows(schemaMock.document, [])

    await expect(rematerializeDocumentAcls('c-1', ['d-1', 'd-2'], transaction)).resolves.toBe(0)

    expect(page).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('writeProjectionPages', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  /** A planned page that splits under the locked reread stops at the budget, not after it. */
  it('stops before the next page once the deadline passes and reports it unfinished', async () => {
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      queueTableRows(schemaMock.document, [
        { id: 'a', chunkCount: 200 },
        { id: 'b', chunkCount: 200 },
        { id: 'c', chunkCount: 200 },
      ])
      const write = vi.fn(async (_tx: unknown, page: string[]) => {
        clock += 2_000
        return page.length
      })

      await expect(
        writeProjectionPages(['a', 'b', 'c'], (fn) => fn(db), write, {
          deadlineAt: clock + 1_000,
        })
      ).resolves.toEqual({ written: 1, finished: false })
      expect(write).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
    }
  })
})

describe('rewriteConnectorAcls', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  const stale = (id: string, aclDiffers = true, evidencePresent = false, chunkCount = 10) => ({
    id,
    externalId: `ext-${id}`,
    chunkCount,
    aclDiffers,
    evidencePresent,
  })
  const held = { stillHeld: () => 'held' as never }
  /** The ids each `acl` assignment targets, in call order. */
  const assignedPages = () =>
    dbChainMockFns.set.mock.calls
      .map(([values], index) => ({ values, where: dbChainMockFns.where.mock.calls[index] }))
      .filter(({ values }) => 'acl' in values)
  const pageSizes = () =>
    dbChainMockFns.set.mock.calls
      .map(([values], index) => ({
        values,
        order: dbChainMockFns.set.mock.invocationCallOrder[index],
      }))
      .filter(({ values }) => 'acl' in values || 'aclRequirements' in values)
      .map(({ order }) => {
        const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
          (whereOrder) => whereOrder > order
        )
        return (
          flattenMockConditions(dbChainMockFns.where.mock.calls[whereIndex]?.[0]).find(
            (node) => node.type === 'inArray' && node.column === schemaMock.document.id
          )?.values as string[]
        ).length
      })

  it('clears evidence without assigning acl where only the evidence is stale', async () => {
    queueTableRows(schemaMock.document, [stale('d-1', false, true), stale('d-2', false, false)])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'd-1' }])
    queueTableRows(schemaMock.document, [])

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).resolves.toBe(true)

    expect(assignedPages()).toHaveLength(0)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ aclRequirements: [], aclVerifiedAt: null })
    expect(pageSizes()).toEqual([1])
  })

  it('writes nothing and opens no transaction on a connector with nothing stale', async () => {
    queueTableRows(
      schemaMock.document,
      Array.from({ length: 500 }, (_unused, index) => stale(`d-${index}`, false))
    )
    queueTableRows(schemaMock.document, [stale('d-last', false)])

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).resolves.toBe(true)

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    /** A full window is followed by the next one, from the last key read. */
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
  })
})

describe('applyMemberDocumentLifecycle', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.mocked(hardDeleteDocuments).mockReset()
  })

  const _lifecycleInput = (
    overrides: Partial<Parameters<typeof applyMemberDocumentLifecycle>[0]> = {}
  ): Parameters<typeof applyMemberDocumentLifecycle>[0] => ({
    connectorId: 'c-1',
    knowledgeBaseId: 'kb-1',
    runId: 'run-1',
    deadlineAt: Date.now() + 60_000,
    allowRemoval: true,
    unobservedDocumentIds: [],
    lease: { beatIfDue: async () => {} },
    withLease: (fn) => fn(db),
    ...overrides,
  })
  const _pageRow = (id: string) => ({ id, externalId: `ext-${id}` })
  /** The WHERE of every statement that targets documents by id, in call order. */
  const _documentUpdateConditions = () =>
    dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .filter((condition) => updatedIds(condition) !== undefined)
  const updatedIds = (condition: unknown) =>
    flattenMockConditions(condition).find(
      (node) => node.type === 'inArray' && node.column === schemaMock.document.id
    )?.values

  it('reports a reclaimed lease during a purge batch as the run being superseded', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
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
        unobservedDocumentIds: [],
        lease: { beatIfDue: async () => {} } as never,
      })
    ).rejects.toBeInstanceOf(SyncLockLostException)
  })
})
