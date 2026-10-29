import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countReconciliationWindows,
  RECONCILIATION_WINDOW_SIZE,
} from '@/lib/knowledge/connectors/reconciliation-window'
import {
  routeWindowScans,
  windowCounts,
} from '@/lib/knowledge/connectors/reconciliation-window.test-helpers'

describe('countReconciliationWindows', () => {
  const conditions = [sql`listed`, sql`absent`]

  beforeEach(() => {
    resetDbChainMock()
    routeWindowScans()
  })

  it('sums a connector larger than one window across window statements', async () => {
    windowCounts.push(
      [{ size: RECONCILIATION_WINDOW_SIZE, last: 'doc-5000', matching: [4000, 7] }],
      [{ size: 12, last: 'doc-5012', matching: [10, 2] }]
    )
    const beforePage = vi.fn(async () => undefined)

    const tally = await countReconciliationWindows({
      connectorId: 'connector',
      conditions,
      deadlineAt: Date.now() + 60_000,
      beforePage,
    })

    expect(tally).toEqual({
      finished: true,
      owned: RECONCILIATION_WINDOW_SIZE + 12,
      matching: [4010, 9],
    })
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(beforePage).toHaveBeenCalledTimes(2)
    expect(windowCounts).toEqual([])
  })

  it('reports an unfinished count instead of reading past its deadline', async () => {
    const tally = await countReconciliationWindows({
      connectorId: 'connector',
      conditions,
      deadlineAt: Date.now() - 1,
      beforePage: async () => undefined,
    })

    expect(tally).toEqual({ finished: false })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })
})
