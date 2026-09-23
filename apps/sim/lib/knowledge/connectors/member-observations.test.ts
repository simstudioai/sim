/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  hasMockCondition,
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
  materializeDocumentAcls,
  pagesByProjectionRows,
  rematerializeDocumentAcls,
  removeUnseenMemberObservations,
  renewMemberObservationsInScopes,
  rewriteConnectorAcls,
  staleMemberWindowMs,
  sweepStaleMemberObservations,
  writeProjectionPages,
} from '@/lib/knowledge/connectors/member-observations'
import {
  MEMBER_OBSERVATION_STALE_AFTER_HOURS,
  MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN,
} from '@/lib/knowledge/connectors/sync-limits'
import { type LeaseTransaction, SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
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
    const candidates = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({ documentId: `${prefix}-${i}` }))
    queueTableRows(schemaMock.knowledgeDocumentObservation, candidates(25, 'd'))
    queueTableRows(schemaMock.knowledgeDocumentObservation, candidates(1, 'last'))
    dbChainMockFns.returning
      .mockResolvedValueOnce(candidates(25, 'd'))
      .mockResolvedValueOnce(candidates(1, 'last'))
    const onRemoved = vi.fn(async (_ids: string[]) => undefined)
    await expect(
      removeUnseenMemberObservations(db, 'member', 'generation', onRemoved)
    ).resolves.toEqual({ removed: 25, finished: false })
    await expect(
      removeUnseenMemberObservations(db, 'member', 'generation', onRemoved)
    ).resolves.toEqual({ removed: 1, finished: true })
    expect(onRemoved.mock.calls.map(([ids]) => (ids as string[]).length)).toEqual([25, 1])
    /** A page rematerialises in the caller's lease transaction, so it holds one ACL batch. */
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(25)
    expect(onRemoved.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[1]
    )
  })

  /** One document above the row cap is a page alone; the rest of the candidates wait. */
  it('removes only the leading page of projection rows and reports more to come', async () => {
    queueTableRows(schemaMock.knowledgeDocumentObservation, [
      { documentId: 'huge' },
      { documentId: 'small' },
    ])
    queueTableRows(schemaMock.document, [
      { id: 'huge', chunkCount: 1_000 },
      { id: 'small', chunkCount: 1 },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ documentId: 'huge' }])
    const onRemoved = vi.fn(async (_ids: string[]) => undefined)

    await expect(
      removeUnseenMemberObservations(db, 'member', 'generation', onRemoved)
    ).resolves.toEqual({ removed: 1, finished: false })
    expect(onRemoved).toHaveBeenCalledWith(['huge'])
  })
})

describe('renewMemberObservationsInScopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('renews only observations under a scope the source still grants', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { documentId: 'd-kept', externalId: 'slack:v4:T1:C1:1.0' },
      { documentId: 'd-lost', externalId: 'slack:v4:T1:C9:1.0' },
      { documentId: 'd-other', externalId: 'slack:v4:T1:C10:1.0' },
      { documentId: 'd-dm', externalId: 'slack:v4:T1:D1:1.0' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { documentId: 'd-kept' },
      { documentId: 'd-dm' },
    ])
    await expect(renew(['slack:v4:T1:C1:', 'slack:v4:T1:D1:'])).resolves.toEqual({
      renewed: 2,
      finished: true,
    })
    expect(renewedIds()).toEqual([['d-kept', 'd-dm']])
  })

  it('matches every id under a broader scope that covers a narrower one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { documentId: 'd-1', externalId: 'slack:v4:T1:C1:1.0' },
      { documentId: 'd-2', externalId: 'slack:v4:T1:C2:1.0' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ documentId: 'd-1' }, { documentId: 'd-2' }])
    await renew(['slack:v4:T1:C2:', 'slack:v4:T1:'])
    expect(renewedIds()).toEqual([['d-1', 'd-2']])
  })

  it('writes nothing when no scope is granted and stops at its deadline', async () => {
    await expect(renew([])).resolves.toEqual({ renewed: 0, finished: true })
    await expect(renew(['slack:v4:T1:C1:'], Date.now() - 1)).resolves.toEqual({
      renewed: 0,
      finished: false,
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('pages through the connector by external id until a short page', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, i) => ({
          documentId: `d-${i}`,
          externalId: `slack:v4:T1:C1:${String(i).padStart(4, '0')}.0`,
        }))
      )
      .mockResolvedValueOnce([{ documentId: 'd-last', externalId: 'slack:v4:T1:C1:9999.0' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ documentId: `d-${i}` })))
      .mockResolvedValueOnce([{ documentId: 'd-last' }])
    await expect(renew(['slack:v4:T1:C1:'])).resolves.toEqual({ renewed: 1001, finished: true })
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
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

  /** Each page rematerialises at most one ACL batch under the shared connector row. */
  it('sweeps a large member in pages of 25, one bounded transaction each', async () => {
    const ids = (count: number, prefix: string) =>
      Array.from({ length: count }, (_unused, index) => `${prefix}-${index}`)
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    for (const page of [ids(25, 'a'), ids(3, 'b')]) {
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
      queueTableRows(
        schemaMock.knowledgeDocumentObservation,
        page.map((documentId) => ({ documentId }))
      )
      dbChainMockFns.returning
        .mockResolvedValueOnce(page.map((documentId) => ({ documentId })))
        .mockResolvedValueOnce(page.map((id) => ({ id })))
        .mockResolvedValueOnce([])
    }

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 1,
      observationsRemoved: 28,
      documentsRematerialized: 28,
      docsTombstoned: 0,
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(25)
    const bounds = dbChainMockFns.execute.mock.calls.filter((call: unknown[]) =>
      JSON.stringify(call).includes('lock_timeout')
    )
    expect(bounds).toHaveLength(2)
  })

  /** A document above the row cap is swept alone; the rest of the member waits for the next page. */
  it('sweeps a document larger than one page of projection rows in a page alone', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    for (const page of [['huge', 'small'], ['small']]) {
      queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
      queueTableRows(
        schemaMock.knowledgeDocumentObservation,
        page.map((documentId) => ({ documentId }))
      )
      queueTableRows(
        schemaMock.document,
        page.map((id) => ({ id, chunkCount: id === 'huge' ? 1_000 : 1 }))
      )
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ documentId: page[0] }])
        .mockResolvedValueOnce([{ id: page[0] }])
        .mockResolvedValueOnce([])
    }

    await expect(sweepStaleMemberObservations(NOW)).resolves.toMatchObject({
      members: 1,
      observationsRemoved: 2,
    })
    const deletedPages = dbChainMockFns.where.mock.calls
      .map(([condition]) =>
        flattenMockConditions(condition).find(
          (node) =>
            node.type === 'inArray' &&
            node.column === schemaMock.knowledgeDocumentObservation.documentId
        )
      )
      .filter((node) => node !== undefined)
      .map((node) => node!.values)
    expect(deletedPages).toEqual([['huge'], ['small']])
  })

  /** The budget is checked before every page, so one large member cannot hold a tick past it. */
  it('leaves the rest of a large member for the next tick once the budget passes mid-member', async () => {
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const page = Array.from({ length: 25 }, (_unused, index) => `a-${index}`)
      queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
      queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
      queueTableRows(
        schemaMock.knowledgeDocumentObservation,
        page.map((documentId) => ({ documentId }))
      )
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      dbChainMockFns.returning
        .mockResolvedValueOnce(page.map((documentId) => ({ documentId })))
        .mockResolvedValueOnce(page.map((id) => ({ id })))
        .mockImplementationOnce(async () => {
          clock += 2_000
          return []
        })

      await expect(sweepStaleMemberObservations(NOW, clock + 1_000)).resolves.toEqual({
        members: 1,
        observationsRemoved: 25,
        documentsRematerialized: 25,
        docsTombstoned: 0,
      })
      expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
    }
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

  /** A connector that left members mode after the selection fails the last check and rolls the page back. */
  it('leaves a connector that left members mode after it was selected', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ documentId: 'd-1' }])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toMatchObject({
      members: 0,
      observationsRemoved: 0,
    })

    expect(dbChainMockFns.for).toHaveBeenLastCalledWith('share')
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it('stops a tick at its wall-clock budget, leaving the rest for the next', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])

    await expect(sweepStaleMemberObservations(NOW, Date.now() - 1)).resolves.toMatchObject({
      members: 0,
    })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})

describe('materializeDocumentAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /** Each rematerialised document rewrites every projection row of its chunks. */
  it('rematerialises 25 documents per statement', async () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `d-${index}`)
    dbChainMockFns.returning
      .mockResolvedValueOnce(ids.slice(0, 25).map((id) => ({ id })))
      .mockResolvedValueOnce(ids.slice(25, 50).map((id) => ({ id })))
      .mockResolvedValueOnce(ids.slice(50).map((id) => ({ id })))

    await expect(materializeDocumentAcls('c-1', ids, db)).resolves.toBe(60)

    const sizes = dbChainMockFns.where.mock.calls.map(
      ([condition]) =>
        flattenMockConditions(condition).find(
          (node) => node.type === 'inArray' && node.column === schemaMock.document.id
        )?.values as string[]
    )
    expect(sizes.map((values) => values.length)).toEqual([25, 25, 10])
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

  it('starts with a page for a leading document above the cap, never an empty one', () => {
    expect(pagesByProjectionRows([doc('huge', 5_000), doc('a', 1)])).toEqual([['huge'], ['a']])
  })

  it('returns no pages for no documents', () => {
    expect(pagesByProjectionRows([])).toEqual([])
  })
})

describe('rematerializeDocumentAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('rematerialises only what differs, in pages bounded by projection rows', async () => {
    queueTableRows(
      schemaMock.document,
      Array.from({ length: 30 }, (_unused, index) => ({ id: `d-${index}`, chunkCount: 10 }))
    )
    dbChainMockFns.returning
      .mockResolvedValueOnce(Array.from({ length: 25 }, (_unused, index) => ({ id: `d-${index}` })))
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_unused, index) => ({ id: `e-${index}` })))

    await expect(
      rematerializeDocumentAcls(
        'c-1',
        Array.from({ length: 40 }, (_unused, index) => `d-${index}`),
        transaction
      )
    ).resolves.toBe(30)

    expect(page).toHaveBeenCalledTimes(2)
  })
})

describe('writeProjectionPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  /** The lease heartbeat runs before each page and can itself use up what is left of the budget. */
  it('opens no transaction when the heartbeat before a page outlasts the deadline', async () => {
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const transaction = vi.fn()
      const write = vi.fn()
      const beforePage = vi.fn(async () => {
        clock += 2_000
      })

      await expect(
        writeProjectionPages(['a'], transaction, write, { beforePage, deadlineAt: clock + 1_000 })
      ).resolves.toEqual({ written: 0, finished: false })
      expect(beforePage).toHaveBeenCalledOnce()
      expect(transaction).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
    }
  })

  it('writes every page when no deadline is given', async () => {
    queueTableRows(schemaMock.document, [
      { id: 'a', chunkCount: 200 },
      { id: 'b', chunkCount: 200 },
    ])
    queueTableRows(schemaMock.document, [{ id: 'b', chunkCount: 200 }])
    const write = vi.fn(async (_tx: unknown, page: string[]) => page.length)

    await expect(writeProjectionPages(['a', 'b'], (fn) => fn(db), write)).resolves.toEqual({
      written: 2,
      finished: true,
    })
    expect(write.mock.calls.map(([, page]) => page)).toEqual([['a'], ['b']])
  })
})

describe('rewriteConnectorAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('proves the lease inside each page transaction before rewriting', async () => {
    queueTableRows(schemaMock.document, [stale('d-1')])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'd-1' }])
    queueTableRows(schemaMock.document, [])

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).resolves.toBe(true)

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
  })

  /** The lease is the page's last statement: a lost lease rolls the page back and ends the rewrite. */
  it('proves the lease after the page writes and stops once it is gone', async () => {
    queueTableRows(
      schemaMock.document,
      Array.from({ length: 60 }, (_unused, index) => stale(`d-${index}`))
    )
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).rejects.toBeInstanceOf(
      SyncLockLostException
    )

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    const leaseCheck = dbChainMockFns.for.mock.calls.findIndex(([mode]) => mode === 'share')
    expect(dbChainMockFns.for.mock.invocationCallOrder[leaseCheck]).toBeGreaterThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
  })

  it('gives a document larger than one page of projection rows a page alone', async () => {
    queueTableRows(schemaMock.document, [
      stale('d-small'),
      stale('d-huge', true, false, 1_000),
      stale('d-next'),
    ])
    for (let page = 0; page < 3; page++) {
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: `written-${page}` }])
    }

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).resolves.toBe(true)

    expect(pageSizes()).toEqual([1, 1, 1])
  })

  /** Each assignment rewrites every projection row of its documents; one page per transaction. */
  it('assigns acl in pages of 25, each in a bounded transaction of its own', async () => {
    const window = Array.from({ length: 60 }, (_unused, index) => stale(`d-${index}`))
    queueTableRows(schemaMock.document, window)
    for (let page = 0; page < 3; page++) {
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: `written-${page}` }])
    }
    queueTableRows(schemaMock.document, [])

    await expect(rewriteConnectorAcls('c-1', [], { lease: held })).resolves.toBe(true)

    expect(assignedPages()).toHaveLength(3)
    expect(pageSizes()).toEqual([25, 25, 10])
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(3)
    const bounds = dbChainMockFns.execute.mock.calls.filter((call: unknown[]) =>
      JSON.stringify(call).includes('lock_timeout')
    )
    expect(bounds).toHaveLength(3)
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

  /** A planned page that splits under the locked reread still stops at the deadline. */
  it('stops unfinished when a split page reaches the deadline', async () => {
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      queueTableRows(schemaMock.document, [
        stale('d-1', true, false, 1),
        stale('d-2', true, false, 1),
      ])
      queueTableRows(schemaMock.document, [
        { id: 'd-1', chunkCount: 200 },
        { id: 'd-2', chunkCount: 200 },
      ])
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      dbChainMockFns.returning.mockImplementationOnce(async () => {
        clock += 2_000
        return [{ id: 'd-1' }]
      })

      await expect(
        rewriteConnectorAcls('c-1', [], { lease: held, deadlineAt: clock + 1_000 })
      ).resolves.toBe(false)
      expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
    }
  })

  it('stops unfinished at the deadline before the next page', async () => {
    queueTableRows(schemaMock.document, [stale('d-1')])

    await expect(
      rewriteConnectorAcls('c-1', [], { lease: held, deadlineAt: Date.now() - 1 })
    ).resolves.toBe(false)

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('applyMemberDocumentLifecycle', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.mocked(hardDeleteDocuments).mockReset()
  })

  const lifecycleInput = (
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
  const pageRow = (id: string) => ({ id, externalId: `ext-${id}` })
  /** The WHERE of every statement that targets documents by id, in call order. */
  const documentUpdateConditions = () =>
    dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .filter((condition) => updatedIds(condition) !== undefined)
  const updatedIds = (condition: unknown) =>
    flattenMockConditions(condition).find(
      (node) => node.type === 'inArray' && node.column === schemaMock.document.id
    )?.values

  it('tombstones the documents whose observations this run removed, rechecking each for an observer', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'd-gone' }])

    await expect(
      applyMemberDocumentLifecycle(
        lifecycleInput({ unobservedDocumentIds: ['d-gone', 'd-still-observed', 'd-gone'] })
      )
    ).resolves.toEqual({ tombstoned: 1, resurrected: 0, purged: 0, finished: true })

    const [targeted] = documentUpdateConditions()
    expect(updatedIds(targeted)).toEqual(['d-gone', 'd-still-observed'])
    expect(hasMockCondition(targeted, (node) => node.type === 'notExists')).toBe(true)
    expect(hasMockCondition(targeted, (node) => node.type === 'isNull')).toBe(true)
  })

  it('checks observations only for the live documents of one bounded page', async () => {
    queueTableRows(schemaMock.document, [pageRow('observed'), pageRow('unobserved')])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'unobserved' }])

    await expect(applyMemberDocumentLifecycle(lifecycleInput())).resolves.toEqual({
      tombstoned: 1,
      resurrected: 0,
      purged: 0,
      finished: true,
    })

    const [pageCondition] = dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .filter((condition) =>
        hasMockCondition(
          condition,
          (node) => node.type === 'eq' && node.left === schemaMock.document.connectorId
        )
      )
    /** The observation check must not filter the page, or LIMIT stops bounding the walk. */
    expect(
      hasMockCondition(pageCondition, (node) => node.type === 'notExists' || node.type === 'exists')
    ).toBe(false)
    expect(
      hasMockCondition(
        pageCondition,
        (node) => node.type === 'isNull' && node.column === schemaMock.document.deletedAt
      )
    ).toBe(true)
    /** An immutable key: `source_seen_at` moves on every listing, so a walk ordered by it never ends. */
    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith({
      type: 'asc',
      column: schemaMock.document.externalId,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(500)
    const [tombstone] = documentUpdateConditions()
    expect(updatedIds(tombstone)).toEqual(['observed', 'unobserved'])
    expect(hasMockCondition(tombstone, (node) => node.type === 'notExists')).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ memberTombstoneCursor: null })
  })

  it('stops after its page budget, saving where the next run resumes', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ cursor: { externalId: 'previous-run' } }])
    for (let page = 0; page < MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN; page++) {
      queueTableRows(
        schemaMock.document,
        Array.from({ length: 500 }, (_, index) => pageRow(`p${page}-${index}`))
      )
    }
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])

    await expect(applyMemberDocumentLifecycle(lifecycleInput())).resolves.toEqual({
      tombstoned: 0,
      resurrected: 0,
      purged: 0,
      finished: true,
    })

    const firstPage = dbChainMockFns.where.mock.calls
      .map(([condition]) => flattenMockConditions(condition))
      .find((nodes) => nodes.some((node) => node.left === schemaMock.document.connectorId))
    expect(firstPage).toContainEqual({
      type: 'gt',
      left: schemaMock.document.externalId,
      right: 'previous-run',
    })
    const cursors = dbChainMockFns.set.mock.calls
      .map(([value]) => value)
      .filter((value) => 'memberTombstoneCursor' in value)
    /** Written once for the run, not once per page. */
    expect(cursors).toHaveLength(1)
    expect(cursors.at(-1)).toEqual({
      memberTombstoneCursor: {
        externalId: `ext-p${MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN - 1}-499`,
      },
    })
    expect(documentUpdateConditions()).toHaveLength(MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN)
  })

  it('leaves remaining work for the next run once the deadline passes', async () => {
    const input = lifecycleInput()
    queueTableRows(
      schemaMock.document,
      Array.from({ length: 500 }, (_, index) => pageRow(`document-${index}`))
    )
    dbChainMockFns.returning.mockResolvedValueOnce(
      Array.from({ length: 500 }, (_, index) => ({ id: `document-${index}` }))
    )
    input.withLease = async (fn) => {
      const value = await fn(db)
      input.deadlineAt = Date.now() - 1
      return value
    }
    expect(await applyMemberDocumentLifecycle(input)).toEqual({
      tombstoned: 500,
      resurrected: 0,
      purged: 0,
      finished: false,
    })
  })

  it('before any completed listing, tombstones only what this run explicitly unobserved', async () => {
    queueTableRows(schemaMock.document, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'd-removed-member' }])
    await expect(
      applyMemberDocumentLifecycle(
        lifecycleInput({ allowRemoval: false, unobservedDocumentIds: ['d-removed-member'] })
      )
    ).resolves.toEqual({ tombstoned: 1, resurrected: 0, purged: 0, finished: true })
    const [targeted] = documentUpdateConditions()
    expect(updatedIds(targeted)).toEqual(['d-removed-member'])
    expect(hasMockCondition(targeted, (node) => node.type === 'notExists')).toBe(true)
    /** Neither the absence reconcile nor the purge runs: absence alone still says nothing. */
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.knowledgeConnector)
    expect(documentUpdateConditions()).toHaveLength(1)
    expect(hardDeleteDocuments).not.toHaveBeenCalled()
  })

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
