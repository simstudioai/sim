/**
 * @vitest-environment node
 */
import { usageLogDailyTotal } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInsert, mockValues, mockOnConflictDoUpdate, mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import {
  applyUsageDailyTotalDelta,
  dayIndexFor,
  readUsageDailyTotals,
  readUsagePeriodTotalsBySource,
  reconcileUsageDailyTotals,
  sumSourceTotals,
} from '@/lib/billing/core/usage-daily-total'

const ENTITY = { type: 'organization' as const, id: 'org-1' }
const PERIOD = {
  start: new Date('2026-07-15T17:21:34.000Z'),
  end: new Date('2026-08-15T17:21:34.000Z'),
}
const USER = 'user-1'
const SOURCE = 'workflow' as const
/** Two full days after the period start, plus a few hours into the third. */
const OCCURRED_AT = new Date('2026-07-18T04:00:00.000Z')

afterAll(() => {
  resetDbChainMock()
})

describe('applyUsageDailyTotalDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnConflictDoUpdate.mockResolvedValue(undefined)
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
    mockInsert.mockReturnValue({ values: mockValues })
  })

  const executor = () => ({ insert: mockInsert }) as never

  it('upserts the delta against the period key', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, SOURCE, OCCURRED_AT, 0.25)

    expect(mockInsert).toHaveBeenCalledWith(usageLogDailyTotal)
    expect(mockValues).toHaveBeenCalledWith({
      billingEntityType: 'organization',
      billingEntityId: 'org-1',
      billingPeriodStart: PERIOD.start,
      billingPeriodEnd: PERIOD.end,
      userId: USER,
      dayIndex: 2,
      source: SOURCE,
      totalCost: '0.25',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('skips a zero delta so a no-op flush creates no row version', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, SOURCE, OCCURRED_AT, 0)

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('skips a non-finite delta rather than poisoning the running total', async () => {
    await applyUsageDailyTotalDelta(
      executor(),
      ENTITY,
      PERIOD,
      USER,
      SOURCE,
      OCCURRED_AT,
      Number.NaN
    )

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('carries a negative delta through so a reversal lowers the total', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, SOURCE, OCCURRED_AT, -0.5)

    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ totalCost: '-0.5' }))
  })
})

describe('dayIndexFor', () => {
  it('counts whole 24h windows from the period start', () => {
    expect(dayIndexFor(PERIOD.start, PERIOD.start)).toBe(0)
    expect(dayIndexFor(PERIOD.start, new Date('2026-07-16T17:21:33.000Z'))).toBe(0)
    expect(dayIndexFor(PERIOD.start, new Date('2026-07-16T17:21:34.000Z'))).toBe(1)
    expect(dayIndexFor(PERIOD.start, OCCURRED_AT)).toBe(2)
  })

  it('floors below the period start so a pre-period event never lands in day 0', () => {
    expect(dayIndexFor(PERIOD.start, new Date('2026-07-15T17:21:33.000Z'))).toBe(-1)
  })
})

describe('readUsagePeriodTotalsBySource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
  })

  it('returns null without querying when rollup reads are disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(readUsagePeriodTotalsBySource(ENTITY, PERIOD)).resolves.toBeNull()
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns a source-keyed breakdown', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { source: 'workflow', totalCost: '10.5' },
      { source: 'copilot', totalCost: '4.25' },
    ])

    await expect(readUsagePeriodTotalsBySource(ENTITY, PERIOD)).resolves.toEqual(
      new Map([
        ['workflow', 10.5],
        ['copilot', 4.25],
      ])
    )
  })

  it('returns null when the period has no buckets so the caller falls back', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([])

    await expect(readUsagePeriodTotalsBySource(ENTITY, PERIOD)).resolves.toBeNull()
  })
})

describe('sumSourceTotals', () => {
  const totals = new Map([
    ['workflow', 10.5],
    ['copilot', 4.25],
    ['workspace-chat', 1.25],
  ] as const)

  it('sums every source when none are named', () => {
    expect(sumSourceTotals(totals as never)).toBeCloseTo(16, 9)
  })

  it('sums only the named sources', () => {
    expect(sumSourceTotals(totals as never, ['copilot', 'workspace-chat'] as never)).toBeCloseTo(
      5.5,
      9
    )
  })

  it('treats a source with no bucket as zero rather than NaN', () => {
    expect(sumSourceTotals(totals as never, ['wand'] as never)).toBe(0)
  })
})

describe('readUsageDailyTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
  })

  it('returns null without querying when rollup reads are disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(readUsageDailyTotals(ENTITY, PERIOD.start, [USER])).resolves.toBeNull()
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns a day-indexed map of totals', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { dayIndex: 0, totalCost: '1.50' },
      { dayIndex: 2, totalCost: '0.25' },
    ])

    const totals = await readUsageDailyTotals(ENTITY, PERIOD.start, [USER])

    expect(totals).toEqual(
      new Map([
        [0, 1.5],
        [2, 0.25],
      ])
    )
  })

  it('returns null when the period has no buckets so the caller falls back', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([])

    await expect(readUsageDailyTotals(ENTITY, PERIOD.start, [USER])).resolves.toBeNull()
  })

  it('short-circuits an empty user set to an empty map, never a ledger fallback', async () => {
    await expect(readUsageDailyTotals(ENTITY, PERIOD.start, [])).resolves.toEqual(new Map())
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })
})

describe('reconcileUsageDailyTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
  })

  it('deletes orphaned buckets as well as rewriting surviving ones', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([1, 1, 1]).mockResolvedValueOnce([1])

    const result = await reconcileUsageDailyTotals()

    expect(result).toEqual({ bucketsWritten: 3, bucketsDeleted: 1 })

    // A user deletion cascades ledger rows away. Recomputing only the groups
    // still present in usage_log can never repair a group whose rows are
    // entirely gone, so the delete pass is what keeps it from over-counting
    // forever — assert it actually runs, not just the upsert.
    const statements = dbChainMockFns.execute.mock.calls.map(([arg]) =>
      JSON.stringify(arg).toLowerCase()
    )
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('insert')
    expect(statements[1]).toContain('delete')
    expect(statements[1]).toContain('not exists')
  })

  it('runs both passes in one transaction', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([1]).mockResolvedValueOnce([])

    await reconcileUsageDailyTotals()

    // Separate transactions would let the delete act on a view of the ledger
    // the upsert never saw, dropping a bucket that is actually live.
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it('skips buckets a live writer touched since the snapshot', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([1]).mockResolvedValueOnce([])

    await reconcileUsageDailyTotals()

    // The recomputed total comes from a snapshot. Without this guard an
    // absolute write would clobber a concurrent increment, and the orphan
    // delete would remove a bucket that was just legitimately created.
    const statements = dbChainMockFns.execute.mock.calls.map(([arg]) =>
      JSON.stringify(arg).toLowerCase()
    )
    expect(statements[0]).toContain('updated_at < now()')
    expect(statements[1]).toContain('updated_at < now()')
  })
})
