/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
  const sqlTag = () => {
    const obj: { as: () => typeof obj } = { as: () => obj }
    return obj
  }
  return {
    ...drizzleOrmMock,
    sql: Object.assign(sqlTag, { raw: sqlTag, param: sqlTag }),
    sum: () => ({ as: () => 'sum' }),
  }
})

vi.mock('@/lib/billing/constants', () => ({
  DAILY_REFRESH_RATE: 0.01,
}))

const { mockReadUsageDailyTotals } = vi.hoisted(() => ({
  mockReadUsageDailyTotals: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-daily-total', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/usage-daily-total')>()),
  readUsageDailyTotals: mockReadUsageDailyTotals,
}))

import {
  computeDailyRefreshConsumed,
  getDailyRefreshDollars,
} from '@/lib/billing/credits/daily-refresh'

describe('computeDailyRefreshConsumed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadUsageDailyTotals.mockResolvedValue(null)
  })

  it('returns 0 when planDollars is 0', async () => {
    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1'],
      periodStart: new Date('2026-03-01'),
      planDollars: 0,
    })
    expect(result).toBe(0)
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns 0 when userIds is empty', async () => {
    const result = await computeDailyRefreshConsumed({
      userIds: [],
      periodStart: new Date('2026-03-01'),
      planDollars: 25,
    })
    expect(result).toBe(0)
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns 0 when periodEnd is before periodStart', async () => {
    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1'],
      periodStart: new Date('2026-03-10'),
      periodEnd: new Date('2026-03-01'),
      planDollars: 25,
    })
    expect(result).toBe(0)
  })

  it('caps each day at the daily refresh allowance', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { dayIndex: 0, dayTotal: '0.50' },
      { dayIndex: 1, dayTotal: '0.10' },
      { dayIndex: 2, dayTotal: '1.00' },
    ])

    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1'],
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-04'),
      planDollars: 25,
    })

    // Daily refresh = $25 * 0.01 = $0.25/day
    // Day 0: MIN(0.50, 0.25) = 0.25
    // Day 1: MIN(0.10, 0.25) = 0.10
    // Day 2: MIN(1.00, 0.25) = 0.25
    // Total = 0.60
    expect(result).toBe(0.6)
  })

  it('returns 0 when no usage rows exist', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([])

    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1'],
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-04'),
      planDollars: 25,
    })

    expect(result).toBe(0)
  })

  it('multiplies daily refresh by seats', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 0, dayTotal: '2.00' }])

    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1', 'user-2', 'user-3'],
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-02'),
      planDollars: 100,
      seats: 3,
    })

    // Daily refresh = $100 * 0.01 * 3 seats = $3.00/day
    // Day 0: MIN(2.00, 3.00) = 2.00
    expect(result).toBe(2.0)
  })

  it('caps at refresh even with high usage and multiple seats', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 0, dayTotal: '50.00' }])

    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1', 'user-2'],
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-02'),
      planDollars: 100,
      seats: 2,
    })

    // Daily refresh = $100 * 0.01 * 2 seats = $2.00/day
    // Day 0: MIN(50.00, 2.00) = 2.00
    expect(result).toBe(2.0)
  })

  it('handles null dayTotal gracefully', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 0, dayTotal: null }])

    const result = await computeDailyRefreshConsumed({
      userIds: ['user-1'],
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-02'),
      planDollars: 25,
    })

    expect(result).toBe(0)
  })
})

describe('getDailyRefreshDollars', () => {
  it('computes correct daily refresh for Pro ($25)', () => {
    expect(getDailyRefreshDollars(25)).toBe(0.25)
  })

  it('computes correct daily refresh for Max ($100)', () => {
    expect(getDailyRefreshDollars(100)).toBe(1.0)
  })

  it('returns 0 for $0 plan', () => {
    expect(getDailyRefreshDollars(0)).toBe(0)
  })
})

describe('computeDailyRefreshConsumed rollup fast path', () => {
  const ENTITY = { type: 'organization' as const, id: 'org-1' }
  const periodStart = new Date(Date.now() - 3 * 86_400_000)
  const periodEnd = new Date(Date.now() + 7 * 86_400_000)

  const base = {
    userIds: ['user-1'],
    periodStart,
    periodEnd,
    planDollars: 100,
    billingEntity: ENTITY,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadUsageDailyTotals.mockResolvedValue(null)
  })

  it('caps each day at the refresh allowance and sums across days', async () => {
    // Allowance is planDollars * DAILY_REFRESH_RATE * seats = 100 * 0.01 = 1.
    mockReadUsageDailyTotals.mockResolvedValue(
      new Map([
        [0, 0.4],
        [1, 5],
        [2, 0.25],
      ])
    )

    const result = await computeDailyRefreshConsumed(base)

    expect(result).toBeCloseTo(0.4 + 1 + 0.25, 9)
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('falls back to the ledger when the rollup cannot answer', async () => {
    // `null` is the single channel the rollup uses for every "cannot answer"
    // case: reads disabled, or no buckets for this period yet.
    mockReadUsageDailyTotals.mockResolvedValue(null)

    await computeDailyRefreshConsumed(base)

    expect(dbChainMockFns.groupBy).toHaveBeenCalled()
  })

  it('falls back to the ledger without a billing entity, which the rollup is keyed by', async () => {
    await computeDailyRefreshConsumed({ ...base, billingEntity: undefined })

    expect(mockReadUsageDailyTotals).not.toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).toHaveBeenCalled()
  })

  it('falls back to the ledger for per-user bounds, which can split a day bucket', async () => {
    await computeDailyRefreshConsumed({
      ...base,
      userBounds: { 'user-1': { userStart: new Date(Date.now() - 2 * 86_400_000 - 3600_000) } },
    })

    expect(mockReadUsageDailyTotals).not.toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).toHaveBeenCalled()
  })

  it('falls back to the ledger for a closed period, where a late flush can sit past the cap', async () => {
    await computeDailyRefreshConsumed({
      ...base,
      periodStart: new Date(Date.now() - 40 * 86_400_000),
      periodEnd: new Date(Date.now() - 86_400_000),
    })

    expect(mockReadUsageDailyTotals).not.toHaveBeenCalled()
    expect(dbChainMockFns.groupBy).toHaveBeenCalled()
  })
})
