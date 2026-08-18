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
  readUsagePeriodTotal,
  reconcileUsageDailyTotals,
} from '@/lib/billing/core/usage-daily-total'

const ENTITY = { type: 'organization' as const, id: 'org-1' }
const PERIOD = {
  start: new Date('2026-07-15T17:21:34.000Z'),
  end: new Date('2026-08-15T17:21:34.000Z'),
}
const USER = 'user-1'
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
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, OCCURRED_AT, 0.25)

    expect(mockInsert).toHaveBeenCalledWith(usageLogDailyTotal)
    expect(mockValues).toHaveBeenCalledWith({
      billingEntityType: 'organization',
      billingEntityId: 'org-1',
      billingPeriodStart: PERIOD.start,
      billingPeriodEnd: PERIOD.end,
      userId: USER,
      dayIndex: 2,
      totalCost: '0.25',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('skips a zero delta so a no-op flush creates no row version', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, OCCURRED_AT, 0)

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('skips a non-finite delta rather than poisoning the running total', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, OCCURRED_AT, Number.NaN)

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('carries a negative delta through so a reversal lowers the total', async () => {
    await applyUsageDailyTotalDelta(executor(), ENTITY, PERIOD, USER, OCCURRED_AT, -0.5)

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

describe('readUsagePeriodTotal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
  })

  it('returns null without querying when rollup reads are disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBeNull()
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('sums every bucket in the period', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ totalCost: '1234.5678' }])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBe(1234.5678)
  })

  it('returns null (not 0) when the period has no buckets so the caller falls back', async () => {
    // SUM over no rows is NULL, and total_cost is NOT NULL, so the sum itself
    // distinguishes "no buckets" from a genuine zero.
    dbChainMockFns.where.mockResolvedValueOnce([{ totalCost: null }])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBeNull()
  })

  it('distinguishes a genuine zero total from an unmaintained period', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ totalCost: '0' }])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBe(0)
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
})
