import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateBillingPeriod, calculateNextBillingPeriod } from './billing-periods'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('Billing Period Calculations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Set consistent date for testing
    vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('calculateBillingPeriod', () => {
    it.concurrent('calculates current period from subscription dates when within period', () => {
      vi.setSystemTime(new Date('2024-01-20T00:00:00Z')) // Within the subscription period

      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const subscriptionEnd = new Date('2024-02-15T00:00:00Z')

      const period = calculateBillingPeriod(subscriptionStart, subscriptionEnd)

      expect(period.start).toEqual(subscriptionStart)
      expect(period.end).toEqual(subscriptionEnd)
    })

    it.concurrent('calculates next period when current period has ended', () => {
      vi.setSystemTime(new Date('2024-03-01T00:00:00Z'))

      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const subscriptionEnd = new Date('2024-02-15T00:00:00Z')

      const period = calculateBillingPeriod(subscriptionStart, subscriptionEnd)

      expect(period.start).toEqual(subscriptionEnd)
      // Expect month-based calculation: Feb 15 + 1 month = Mar 15
      expect(period.end.getUTCFullYear()).toBe(2024)
      expect(period.end.getUTCMonth()).toBe(2) // March (0-indexed)
      expect(period.end.getUTCDate()).toBe(15)
    })

    it.concurrent('calculates monthly periods from subscription start date', () => {
      vi.setSystemTime(new Date('2024-01-20T00:00:00Z'))

      const subscriptionStart = new Date('2024-01-15T00:00:00Z')

      const period = calculateBillingPeriod(subscriptionStart)

      expect(period.start).toEqual(subscriptionStart)
      expect(period.end).toEqual(new Date('2024-02-15T00:00:00Z'))
    })

    it.concurrent('advances periods when past end date', () => {
      vi.setSystemTime(new Date('2024-03-20T00:00:00Z'))

      const subscriptionStart = new Date('2024-01-15T00:00:00Z')

      const period = calculateBillingPeriod(subscriptionStart)

      expect(period.start).toEqual(new Date('2024-03-15T00:00:00Z'))
      expect(period.end).toEqual(new Date('2024-04-15T00:00:00Z'))
    })

    it.concurrent('falls back to calendar month when no subscription data', () => {
      vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))

      const period = calculateBillingPeriod()

      expect(period.start.getUTCFullYear()).toBe(2024)
      expect(period.start.getUTCMonth()).toBe(6) // July (0-indexed)
      expect(period.start.getUTCDate()).toBe(1)
      expect(period.end.getUTCFullYear()).toBe(2024)
      expect(period.end.getUTCMonth()).toBe(6) // July (0-indexed)
      expect(period.end.getUTCDate()).toBe(31)
    })
  })

  describe('calculateNextBillingPeriod', () => {
    it.concurrent('calculates next period from given end date', () => {
      const periodEnd = new Date('2024-02-15T00:00:00Z')

      const nextPeriod = calculateNextBillingPeriod(periodEnd)

      expect(nextPeriod.start).toEqual(periodEnd)
      expect(nextPeriod.end.getUTCFullYear()).toBe(2024)
      expect(nextPeriod.end.getUTCMonth()).toBe(2) // March (0-indexed)
      expect(nextPeriod.end.getUTCDate()).toBe(15)
    })

    it.concurrent('handles month transitions correctly', () => {
      const periodEnd = new Date('2024-01-31T00:00:00Z')

      const nextPeriod = calculateNextBillingPeriod(periodEnd)

      expect(nextPeriod.start).toEqual(periodEnd)
      // JavaScript's setUTCMonth handles overflow: Jan 31 + 1 month = Mar 2 (Feb 29 + 2 days in 2024)
      expect(nextPeriod.end.getUTCMonth()).toBe(2) // March (0-indexed) due to overflow
    })
  })

  describe('Period Alignment Scenarios', () => {
    it.concurrent('aligns with mid-month subscription perfectly', () => {
      vi.setSystemTime(new Date('2024-03-20T00:00:00Z')) // Within the subscription period

      const midMonthStart = new Date('2024-03-15T10:30:00Z')
      const midMonthEnd = new Date('2024-04-15T10:30:00Z')

      const period = calculateBillingPeriod(midMonthStart, midMonthEnd)

      expect(period.start.getTime()).toBe(midMonthStart.getTime())
      expect(period.end.getTime()).toBe(midMonthEnd.getTime())
    })

    it.concurrent('handles annual subscriptions correctly', () => {
      vi.setSystemTime(new Date('2024-06-15T00:00:00Z')) // Within the annual subscription period

      const annualStart = new Date('2024-01-01T00:00:00Z')
      const annualEnd = new Date('2025-01-01T00:00:00Z')

      const period = calculateBillingPeriod(annualStart, annualEnd)

      expect(period.start.getTime()).toBe(annualStart.getTime())
      expect(period.end.getTime()).toBe(annualEnd.getTime())
    })
  })

  describe('Billing Check Scenarios', () => {
    it.concurrent('identifies subscriptions ending today', () => {
      const today = new Date('2024-07-06T00:00:00Z')
      vi.setSystemTime(today)

      const endingToday = new Date(today)
      const shouldBill = endingToday.toDateString() === today.toDateString()

      expect(shouldBill).toBe(true)
    })

    it.concurrent('excludes subscriptions ending tomorrow', () => {
      const today = new Date('2024-07-06T00:00:00Z')
      vi.setSystemTime(today)

      const endingTomorrow = new Date(today)
      endingTomorrow.setUTCDate(endingTomorrow.getUTCDate() + 1)

      const shouldBill = endingTomorrow.toDateString() === today.toDateString()

      expect(shouldBill).toBe(false)
    })

    it.concurrent('excludes subscriptions that ended yesterday', () => {
      const today = new Date('2024-07-06T00:00:00Z')
      vi.setSystemTime(today)

      const endedYesterday = new Date(today)
      endedYesterday.setUTCDate(endedYesterday.getUTCDate() - 1)

      const shouldBill = endedYesterday.toDateString() === today.toDateString()

      expect(shouldBill).toBe(false)
    })
  })
})
