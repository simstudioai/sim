/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import { drainRowsByColumn } from '@/lib/cleanup/batch-delete'

const baseOpts = {
  tableDef: {} as never,
  idCol: 'col.id' as never,
  matchCol: 'col.tableId' as never,
  matchValue: 'tbl-1',
  tableName: 'test/userTableRows',
}

function returnRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }))
}

describe('drainRowsByColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('drains in batches until a short batch and reports the set fully drained', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockResolvedValueOnce(returnRows(1))

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 3, fullyDrained: true })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(2)
  })

  it('stops at the budget and reports not fully drained when rows remain', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockResolvedValueOnce(returnRows(2))
    // Existence probe after the budget is spent finds a leftover row.
    dbChainMockFns.limit.mockResolvedValue([{ id: 'leftover' }])

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 4 })

    expect(result).toEqual({ deleted: 4, fullyDrained: false })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(2)
  })

  it('reports fully drained when the budget is hit but the set emptied exactly', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockResolvedValueOnce(returnRows(2))
    // Existence probe finds nothing remaining.
    dbChainMockFns.limit.mockResolvedValue([])

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 4 })

    expect(result).toEqual({ deleted: 4, fullyDrained: true })
  })

  it('reports fully drained immediately when the match set is already empty', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 0, fullyDrained: true })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(1)
  })

  it('reports not fully drained on a batch error so the caller defers the cascade', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockRejectedValueOnce(new Error('db down'))

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 2, fullyDrained: false })
  })
})
