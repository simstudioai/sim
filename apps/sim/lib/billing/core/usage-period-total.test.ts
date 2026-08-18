/**
 * @vitest-environment node
 */
import { usageLogPeriodTotal } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInsert, mockValues, mockOnConflictDoUpdate } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
}))

import {
  applyUsagePeriodTotalDelta,
  readUsagePeriodTotal,
} from '@/lib/billing/core/usage-period-total'

const ENTITY = { type: 'organization' as const, id: 'org-1' }
const PERIOD = {
  start: new Date('2026-07-15T17:21:34.000Z'),
  end: new Date('2026-08-15T17:21:34.000Z'),
}

afterAll(() => {
  resetDbChainMock()
})

describe('applyUsagePeriodTotalDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnConflictDoUpdate.mockResolvedValue(undefined)
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
    mockInsert.mockReturnValue({ values: mockValues })
  })

  const executor = () => ({ insert: mockInsert }) as never

  it('upserts the delta against the period key', async () => {
    await applyUsagePeriodTotalDelta(executor(), ENTITY, PERIOD, 0.25)

    expect(mockInsert).toHaveBeenCalledWith(usageLogPeriodTotal)
    expect(mockValues).toHaveBeenCalledWith({
      billingEntityType: 'organization',
      billingEntityId: 'org-1',
      billingPeriodStart: PERIOD.start,
      billingPeriodEnd: PERIOD.end,
      totalCost: '0.25',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('skips a zero delta so a no-op flush creates no row version', async () => {
    await applyUsagePeriodTotalDelta(executor(), ENTITY, PERIOD, 0)

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('skips a non-finite delta rather than poisoning the running total', async () => {
    await applyUsagePeriodTotalDelta(executor(), ENTITY, PERIOD, Number.NaN)

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('carries a negative delta through so a reversal lowers the total', async () => {
    await applyUsagePeriodTotalDelta(executor(), ENTITY, PERIOD, -0.5)

    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ totalCost: '-0.5' }))
  })
})

describe('readUsagePeriodTotal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the parsed running total', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ totalCost: '1234.5678' }])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBe(1234.5678)
  })

  it('returns null (not 0) when no row exists so the caller falls back to the ledger', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBeNull()
  })

  it('distinguishes a genuine zero total from a missing row', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ totalCost: '0' }])

    await expect(readUsagePeriodTotal(ENTITY, PERIOD)).resolves.toBe(0)
  })
})
