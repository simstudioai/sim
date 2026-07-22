import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  databaseMock,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from './database.mock'

const workflowTable = { id: 'id', name: 'name' }
const memberTable = { id: 'id', userId: 'userId' }

type MockDb = Record<string, any>

const db = dbChainMock.db as MockDb

describe('database mock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('shares one db instance between dbChainMock and databaseMock', () => {
    expect(databaseMock.db).toBe(dbChainMock.db)
    expect(databaseMock.dbReplica).toBe(dbChainMock.db)
    expect(dbChainMock.dbFor()).toBe(dbChainMock.db)
  })

  it('resolves empty arrays by default at every terminal', async () => {
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([])
    await expect(db.select().from(workflowTable).where({}).limit(5)).resolves.toEqual([])
    await expect(db.select().from(workflowTable).where({}).orderBy('id')).resolves.toEqual([])
    await expect(db.insert(workflowTable).values({}).returning()).resolves.toEqual([])
    await expect(db.update(workflowTable).set({}).where({})).resolves.toEqual([])
    await expect(db.delete(workflowTable).where({})).resolves.toEqual([])
  })

  it('routes queued rows to the chain reading that table', async () => {
    queueTableRows(workflowTable, [{ id: 'w-1' }])
    queueTableRows(memberTable, [{ id: 'm-1' }, { id: 'm-2' }])

    await expect(db.select().from(memberTable).where({})).resolves.toEqual([
      { id: 'm-1' },
      { id: 'm-2' },
    ])
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([{ id: 'w-1' }])
  })

  it('consumes queued sets FIFO per table and falls back to empty', async () => {
    queueTableRows(workflowTable, [{ id: 'first' }])
    queueTableRows(workflowTable, [{ id: 'second' }])

    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([{ id: 'first' }])
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([{ id: 'second' }])
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([])
  })

  it('resolves queued rows through downstream terminals (limit/orderBy/joins)', async () => {
    queueTableRows(workflowTable, [{ id: 'w-1' }])
    await expect(db.select().from(workflowTable).where({}).limit(1)).resolves.toEqual([
      { id: 'w-1' },
    ])

    queueTableRows(workflowTable, [{ id: 'w-2' }])
    await expect(
      db.select().from(workflowTable).innerJoin(memberTable, {}).where({}).orderBy('id')
    ).resolves.toEqual([{ id: 'w-2' }])
  })

  it('resolves queued rows when a from-chain is awaited directly (no where)', async () => {
    queueTableRows(workflowTable, [{ id: 'direct' }])
    await expect(db.select().from(workflowTable)).resolves.toEqual([{ id: 'direct' }])
    await expect(db.select().from(workflowTable)).resolves.toEqual([])
  })

  it('routes rows queued for a table referenced only by a join', async () => {
    queueTableRows(memberTable, [{ id: 'joined' }])
    await expect(
      db.select().from(workflowTable).leftJoin(memberTable, {}).where({})
    ).resolves.toEqual([{ id: 'joined' }])
  })

  it('prefers the from-table queue over a join-table queue', async () => {
    queueTableRows(workflowTable, [{ id: 'from-row' }])
    queueTableRows(memberTable, [{ id: 'join-row' }])
    await expect(
      db.select().from(workflowTable).innerJoin(memberTable, {}).where({})
    ).resolves.toEqual([{ id: 'from-row' }])
  })

  it('never lets mutation chains consume select queues', async () => {
    queueTableRows(workflowTable, [{ id: 'kept' }])
    await expect(db.update(workflowTable).set({}).where({})).resolves.toEqual([])
    await expect(db.delete(workflowTable).where({})).resolves.toEqual([])
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([{ id: 'kept' }])
  })

  it('routes selectDistinctOn chains through the same table queues', async () => {
    queueTableRows(memberTable, [{ id: 'm-1' }])
    await expect(db.selectDistinctOn(['id']).from(memberTable).where({})).resolves.toEqual([
      { id: 'm-1' },
    ])
    expect(dbChainMockFns.selectDistinctOn).toHaveBeenCalledTimes(1)
  })

  it('lets per-test ...Once overrides win over queued rows downstream', async () => {
    queueTableRows(workflowTable, [{ id: 'queued' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'override' }])
    await expect(db.select().from(workflowTable).where({}).limit(1)).resolves.toEqual([
      { id: 'override' },
    ])
  })

  it('clears queues and rewires defaults on resetDbChainMock', async () => {
    queueTableRows(workflowTable, [{ id: 'stale' }])
    dbChainMockFns.where.mockReturnValue('broken' as never)
    resetDbChainMock()
    await expect(db.select().from(workflowTable).where({})).resolves.toEqual([])
  })

  it('runs transactions against the same shared instance', async () => {
    queueTableRows(workflowTable, [{ id: 'tx-row' }])
    const rows = await db.transaction(async (tx: MockDb) => {
      expect(tx).toBe(db)
      return tx.select().from(workflowTable).where({})
    })
    expect(rows).toEqual([{ id: 'tx-row' }])
  })
})
