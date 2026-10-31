import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECONCILIATION_RETAINED_MATCHES,
  RECONCILIATION_WINDOW_SIZE,
  tallyReconciliationWindows,
} from '@/lib/knowledge/connectors/reconciliation-window'
import {
  routeWindowTallies,
  windowTallies,
} from '@/lib/knowledge/connectors/reconciliation-window.test-helpers'

describe('tallyReconciliationWindows', () => {
  const conditions = [
    { where: sql`listed`, retain: false },
    { where: sql`absent`, retain: true },
  ]
  /** One window's tally row: its size and listed count, then the live absent documents it read. */
  const window = (size: number, listed: number, absent: string[]) => [
    {
      size,
      last: size > 0 ? `last-${windowTallies.length}` : null,
      counts: [listed, absent.length],
      ids: [[], absent],
      tombstoned: [[], absent.map(() => false)],
    },
  ]
  const absentIds = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${index}`)
  const tally = (beforePage = async () => undefined) =>
    tallyReconciliationWindows({
      connectorId: 'connector',
      conditions,
      deadlineAt: Date.now() + 60_000,
      beforePage,
    })

  beforeEach(() => {
    resetDbChainMock()
    routeWindowTallies()
  })

  it('sums a connector larger than one window and keeps the retained rows of every window', async () => {
    windowTallies.push(
      window(RECONCILIATION_WINDOW_SIZE, 4000, ['doc-7', 'doc-9']),
      window(12, 10, ['doc-5011'])
    )
    const beforePage = vi.fn(async () => undefined)

    expect(await tally(beforePage)).toEqual({
      finished: true,
      owned: RECONCILIATION_WINDOW_SIZE + 12,
      matching: [
        { count: 4010, rows: undefined },
        {
          count: 3,
          rows: ['doc-7', 'doc-9', 'doc-5011'].map((id) => ({ id, tombstoned: false })),
        },
      ],
    })
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(beforePage).toHaveBeenCalledTimes(2)
    expect(windowTallies).toEqual([])
  })

  it('keeps every row up to the retention bound and only the count past it', async () => {
    const full = RECONCILIATION_WINDOW_SIZE
    const windows = Math.ceil(RECONCILIATION_RETAINED_MATCHES / full)
    const fullWindows = () =>
      Array.from({ length: windows }, (_, index) =>
        window(full, 0, absentIds(`w${index}`, RECONCILIATION_RETAINED_MATCHES / windows))
      )

    windowTallies.push(...fullWindows(), window(0, 0, []))
    const atBound = await tally()
    expect(atBound.finished && atBound.matching[1]).toEqual({
      count: RECONCILIATION_RETAINED_MATCHES,
      rows: Array.from({ length: windows }, (_, index) =>
        absentIds(`w${index}`, RECONCILIATION_RETAINED_MATCHES / windows)
      )
        .flat()
        .map((id) => ({ id, tombstoned: false })),
    })

    windowTallies.push(...fullWindows(), window(1, 0, ['one-more']))
    const pastBound = await tally()
    expect(pastBound.finished && pastBound.matching[1]).toEqual({
      count: RECONCILIATION_RETAINED_MATCHES + 1,
      rows: undefined,
    })
  })

  it('reports an unfinished tally instead of reading past its deadline', async () => {
    const result = await tallyReconciliationWindows({
      connectorId: 'connector',
      conditions,
      deadlineAt: Date.now() - 1,
      beforePage: async () => undefined,
    })

    expect(result).toEqual({ finished: false })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })
})
