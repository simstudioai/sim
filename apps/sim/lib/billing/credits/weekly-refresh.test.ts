/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
  const sqlTag = () => {
    const obj: { as: () => typeof obj } = { as: () => obj }
    return obj
  }
  return {
    ...drizzleOrmMock,
    sql: Object.assign(sqlTag, { raw: sqlTag }),
    sum: () => ({ as: () => 'sum' }),
  }
})

import {
  computeBillingPeriodUsageWithWeeklyRefresh,
  computeWeeklyRefreshConsumed,
} from '@/lib/billing/credits/weekly-refresh'

/**
 * Refresh caps windows at `Date.now()`, so the suite pins the clock after
 * every fixture period to stay hermetic on any host date.
 */
const FROZEN_NOW = new Date('2026-08-15T00:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FROZEN_NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

describe('computeBillingPeriodUsageWithWeeklyRefresh', () => {
  const periodStart = new Date('2026-03-01T00:00:00.000Z')
  const periodEnd = new Date('2026-04-01T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the exact ledger end bound while computing refresh from weekly buckets', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { ledgerTotal: '25.00', refreshWeekTotal: '12.00' },
      { ledgerTotal: '25.00', refreshWeekTotal: '4.00' },
    ])

    await expect(
      computeBillingPeriodUsageWithWeeklyRefresh({
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: { start: periodStart, end: periodEnd },
        refreshPeriodStart: periodStart,
        refreshPeriodEnd: periodEnd,
        weeklyRefreshDollars: 10,
      })
    ).resolves.toEqual({ ledgerUsage: 25, refreshConsumed: 14 })

    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(
      schemaMock.usageLog.billingPeriodStart,
      periodStart
    )
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.usageLog.billingPeriodEnd, periodEnd)
  })

  it('uses the reporting time range for the ledger while retaining captured-period refresh', async () => {
    const reportingStart = new Date('2026-01-01T00:00:00.000Z')
    const reportingEnd = new Date('2027-01-01T00:00:00.000Z')
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { ledgerTotal: '20.00', refreshWeekTotal: '0.20' },
    ])

    await computeBillingPeriodUsageWithWeeklyRefresh({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: reportingStart,
        end: reportingEnd,
        source: 'reporting',
      },
      refreshPeriodStart: periodStart,
      refreshPeriodEnd: periodEnd,
      weeklyRefreshDollars: 10,
    })

    expect(drizzleOrmMock.gte).toHaveBeenCalledWith(schemaMock.usageLog.createdAt, reportingStart)
    expect(drizzleOrmMock.lt).toHaveBeenCalledWith(schemaMock.usageLog.createdAt, reportingEnd)
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(
      schemaMock.usageLog.billingPeriodStart,
      periodStart
    )
    expect(drizzleOrmMock.eq).not.toHaveBeenCalledWith(
      schemaMock.usageLog.billingPeriodEnd,
      reportingEnd
    )
  })
})

describe('computeWeeklyRefreshConsumed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when weeklyRefreshDollars is 0', async () => {
    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      weeklyRefreshDollars: 0,
    })
    expect(result).toBe(0)
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns 0 when periodEnd is before periodStart', async () => {
    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-10'),
      periodEnd: new Date('2026-03-01'),
      weeklyRefreshDollars: 10,
    })
    expect(result).toBe(0)
  })

  it('scopes rows by the entity and period stamps, never an actor list', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 0, weekTotal: '0.10' }])
    const periodStart = new Date('2026-03-01')

    await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'organization', id: 'org-1' },
      periodStart,
      periodEnd: new Date('2026-03-08'),
      weeklyRefreshDollars: 10,
    })

    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(
      schemaMock.usageLog.billingEntityType,
      'organization'
    )
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.usageLog.billingEntityId, 'org-1')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(
      schemaMock.usageLog.billingPeriodStart,
      periodStart
    )
    expect(drizzleOrmMock.inArray).not.toHaveBeenCalled()
  })

  it('keeps straggler rows stamped to the period but written after its end', async () => {
    // A run that started before the rollover inserts rows stamped with the
    // elapsed period after it ended; the stamp-based close bills them, so the
    // deduction must include them too (clamped into the final week bucket —
    // index 4 for a 31-day period).
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 4, weekTotal: '12.00' }])
    const periodStart = new Date('2026-03-01')
    const periodEnd = new Date('2026-04-01')

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart,
      periodEnd,
      weeklyRefreshDollars: 10,
    })

    expect(result).toBe(10)
    // Membership is stamp-only: no created-at bound may exclude a row the
    // stamped ledger total includes.
    expect(drizzleOrmMock.lt).not.toHaveBeenCalledWith(schemaMock.usageLog.createdAt, periodEnd)
    expect(drizzleOrmMock.gte).not.toHaveBeenCalled()
  })

  it('rejects windows beyond the supported annual bound', async () => {
    await expect(
      computeWeeklyRefreshConsumed({
        billingEntity: { type: 'organization', id: 'org-1' },
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2026-03-01'),
        weeklyRefreshDollars: 10,
      })
    ).rejects.toThrow('annual bound')
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('caps each week at the weekly refresh allowance', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { weekIndex: 0, weekTotal: '15.00' },
      { weekIndex: 1, weekTotal: '2.00' },
      { weekIndex: 2, weekTotal: '50.00' },
    ])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-22'),
      weeklyRefreshDollars: 10,
    })

    // All usage inside a 7-day window shares one $10 allowance:
    // Week 0: MIN(15.00, 10) = 10
    // Week 1: MIN(2.00, 10) = 2
    // Week 2: MIN(50.00, 10) = 10
    // Total = 22
    expect(result).toBe(22)
  })

  it('grants the full allowance to a partial final week', async () => {
    // 9-day period = one full week + a 2-day partial week. The MIN cap never
    // prorates: the partial window still carries the full $10 allowance.
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { weekIndex: 0, weekTotal: '3.00' },
      { weekIndex: 1, weekTotal: '50.00' },
    ])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-10'),
      weeklyRefreshDollars: 10,
    })

    expect(result).toBe(13)
  })

  it('caps an open-ended period at now', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 1, weekTotal: '12.00' }])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-08-01'),
      periodEnd: null,
      weeklyRefreshDollars: 10,
    })

    expect(result).toBe(10)
  })

  it('returns 0 when no usage rows exist', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-22'),
      weeklyRefreshDollars: 10,
    })

    expect(result).toBe(0)
  })

  it('multiplies the weekly allowance by seats', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 0, weekTotal: '40.00' }])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'organization', id: 'org-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-08'),
      weeklyRefreshDollars: 20,
      seats: 3,
    })

    // Weekly allowance = $20 * 3 seats = $60/week
    // Week 0: MIN(40.00, 60.00) = 40.00
    expect(result).toBe(40)
  })

  it('caps at the allowance even with high usage and multiple seats', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 0, weekTotal: '500.00' }])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'organization', id: 'org-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-08'),
      weeklyRefreshDollars: 20,
      seats: 2,
    })

    // Weekly allowance = $20 * 2 seats = $40/week
    // Week 0: MIN(500.00, 40.00) = 40.00
    expect(result).toBe(40)
  })

  it('handles null weekTotal gracefully', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ weekIndex: 0, weekTotal: null }])

    const result = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-08'),
      weeklyRefreshDollars: 10,
    })

    expect(result).toBe(0)
  })
})
