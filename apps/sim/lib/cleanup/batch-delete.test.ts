/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns } from '@sim/testing'
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
  })

  it('drains in batches until a short batch and reports the set exhausted', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockResolvedValueOnce(returnRows(1))

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 3, budgetExhausted: false })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(2)
  })

  it('stops at the row budget and reports it exhausted', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockResolvedValueOnce(returnRows(2))

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 4 })

    expect(result).toEqual({ deleted: 4, budgetExhausted: true })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(2)
  })

  it('returns immediately when the match set is already empty', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 0, budgetExhausted: false })
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(1)
  })

  it('bails without throwing when a batch delete fails', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce(returnRows(2))
      .mockRejectedValueOnce(new Error('db down'))

    const result = await drainRowsByColumn({ ...baseOpts, batchSize: 2, rowBudget: 10 })

    expect(result).toEqual({ deleted: 2, budgetExhausted: false })
  })
})
