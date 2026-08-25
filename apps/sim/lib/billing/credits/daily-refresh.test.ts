/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/billing/constants', () => ({
  DAILY_REFRESH_RATE: 0.01,
}))

import {
  computeBillingPeriodUsageWithDailyRefresh,
  computeDailyRefreshConsumed,
} from '@/lib/billing/credits/daily-refresh'

describe('computeBillingPeriodUsageWithDailyRefresh', () => {
  const periodStart = new Date('2026-03-01T00:00:00.000Z')
  const periodEnd = new Date('2026-04-01T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the exact ledger end bound while computing refresh from daily buckets', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { ledgerTotal: '12.50', refreshDayTotal: '0.50' },
      { ledgerTotal: '12.50', refreshDayTotal: '0.10' },
    ])

    await expect(
      computeBillingPeriodUsageWithDailyRefresh({
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: { start: periodStart, end: periodEnd },
        refreshPeriodStart: periodStart,
        refreshPeriodEnd: periodEnd,
        planDollars: 25,
      })
    ).resolves.toEqual({ ledgerUsage: 12.5, refreshConsumed: 0.35 })

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
      { ledgerTotal: '20.00', refreshDayTotal: '0.20' },
    ])

    await computeBillingPeriodUsageWithDailyRefresh({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: reportingStart,
        end: reportingEnd,
        source: 'reporting',
      },
      refreshPeriodStart: periodStart,
      refreshPeriodEnd: periodEnd,
      planDollars: 25,
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

describe('computeDailyRefreshConsumed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when planDollars is 0', async () => {
    const result = await computeDailyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      planDollars: 0,
    })
    expect(result).toBe(0)
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('returns 0 when periodEnd is before periodStart', async () => {
    const result = await computeDailyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-10'),
      periodEnd: new Date('2026-03-01'),
      planDollars: 25,
    })
    expect(result).toBe(0)
  })

  it('scopes rows by the entity and period stamps, never an actor list', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 0, dayTotal: '0.10' }])
    const periodStart = new Date('2026-03-01')

    await computeDailyRefreshConsumed({
      billingEntity: { type: 'organization', id: 'org-1' },
      periodStart,
      periodEnd: new Date('2026-03-02'),
      planDollars: 25,
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
    // deduction must include them too (clamped into the final day bucket).
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 30, dayTotal: '0.30' }])
    const periodStart = new Date('2026-03-01')
    const periodEnd = new Date('2026-04-01')

    const result = await computeDailyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart,
      periodEnd,
      planDollars: 25,
    })

    expect(result).toBe(0.25)
    // Membership is stamp-only: no created-at bound may exclude a row the
    // stamped ledger total includes.
    expect(drizzleOrmMock.lt).not.toHaveBeenCalledWith(schemaMock.usageLog.createdAt, periodEnd)
    expect(drizzleOrmMock.gte).not.toHaveBeenCalled()
  })

  it('rejects windows beyond the supported annual bound', async () => {
    await expect(
      computeDailyRefreshConsumed({
        billingEntity: { type: 'organization', id: 'org-1' },
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2026-03-01'),
        planDollars: 25,
      })
    ).rejects.toThrow('annual bound')
    expect(dbChainMockFns.groupBy).not.toHaveBeenCalled()
  })

  it('caps each day at the daily refresh allowance', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([
      { dayIndex: 0, dayTotal: '0.50' },
      { dayIndex: 1, dayTotal: '0.10' },
      { dayIndex: 2, dayTotal: '1.00' },
    ])

    const result = await computeDailyRefreshConsumed({
      billingEntity: { type: 'user', id: 'user-1' },
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
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-04'),
      planDollars: 25,
    })

    expect(result).toBe(0)
  })

  it('multiplies daily refresh by seats', async () => {
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ dayIndex: 0, dayTotal: '2.00' }])

    const result = await computeDailyRefreshConsumed({
      billingEntity: { type: 'organization', id: 'org-1' },
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
      billingEntity: { type: 'organization', id: 'org-1' },
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
      billingEntity: { type: 'user', id: 'user-1' },
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-03-02'),
      planDollars: 25,
    })

    expect(result).toBe(0)
  })
})
