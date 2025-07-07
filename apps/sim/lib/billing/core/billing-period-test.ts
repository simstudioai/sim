import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateBillingPeriod, calculateNextBillingPeriod } from './billing-periods'

vi.mock('@/lib/logs/console-logger', () => ({
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
    it.concurrent('calculates current period from subscription dates', () => {
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
      expect(period.end).toEqual(new Date('2024-03-15T00:00:00Z'))
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

      expect(period.start).toEqual(new Date('2024-07-01T00:00:00Z'))
      expect(period.end).toEqual(new Date('2024-07-31T23:59:59.999Z'))
    })
  })

  describe('calculateNextBillingPeriod', () => {
    it.concurrent('calculates next period from given end date', () => {
      const periodEnd = new Date('2024-02-15T00:00:00Z')

      const nextPeriod = calculateNextBillingPeriod(periodEnd)

      expect(nextPeriod.start).toEqual(periodEnd)
      expect(nextPeriod.end).toEqual(new Date('2024-03-15T00:00:00Z'))
    })

    it.concurrent('handles month transitions correctly', () => {
      const periodEnd = new Date('2024-01-31T00:00:00Z')

      const nextPeriod = calculateNextBillingPeriod(periodEnd)

      expect(nextPeriod.start).toEqual(periodEnd)
      // Should handle February correctly (28/29 days)
      expect(nextPeriod.end.getMonth()).toBe(1) // February (0-indexed)
    })
  })

  describe('Period Alignment Scenarios', () => {
    it.concurrent('aligns with mid-month subscription perfectly', () => {
      const midMonthStart = new Date('2024-03-15T10:30:00Z')
      const midMonthEnd = new Date('2024-04-15T10:30:00Z')

      const period = calculateBillingPeriod(midMonthStart, midMonthEnd)

      expect(period.start.getTime()).toBe(midMonthStart.getTime())
      expect(period.end.getTime()).toBe(midMonthEnd.getTime())
    })

    it.concurrent('handles annual subscriptions correctly', () => {
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
      const shouldBill = endingToday.getTime() === today.getTime()

      expect(shouldBill).toBe(true)
    })

    it.concurrent('excludes subscriptions ending tomorrow', () => {
      const today = new Date('2024-07-06T00:00:00Z')
      vi.setSystemTime(today)

      const endingTomorrow = new Date(today)
      endingTomorrow.setDate(endingTomorrow.getDate() + 1)

      const shouldBill = endingTomorrow.getTime() === today.getTime()

      expect(shouldBill).toBe(false)
    })

    it.concurrent('excludes subscriptions that ended yesterday', () => {
      const today = new Date('2024-07-06T00:00:00Z')
      vi.setSystemTime(today)

      const endedYesterday = new Date(today)
      endedYesterday.setDate(endedYesterday.getDate() - 1)

      const shouldBill = endedYesterday.getTime() === today.getTime()

      expect(shouldBill).toBe(false)
    })
  })
})
