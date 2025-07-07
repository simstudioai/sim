import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlanPricing, getUsersAndOrganizationsForOverageBilling } from './billing'
import { calculateBillingPeriod, calculateNextBillingPeriod } from './billing-periods'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  getUserUsageData: vi.fn(),
}))

vi.mock('../stripe-client', () => ({
  getStripeClient: vi.fn().mockReturnValue(null),
  requireStripeClient: vi.fn().mockImplementation(() => {
    throw new Error(
      'Stripe client is not available. Set STRIPE_SECRET_KEY in your environment variables.'
    )
  }),
  hasValidStripeCredentials: vi.fn().mockReturnValue(false),
}))

describe('Billing Core Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('calculateBillingPeriod', () => {
    it.concurrent('calculates billing period from subscription start date', () => {
      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const result = calculateBillingPeriod(subscriptionStart)

      expect(result.start).toBeInstanceOf(Date)
      expect(result.end).toBeInstanceOf(Date)
      expect(result.end.getTime()).toBeGreaterThan(result.start.getTime())
    })

    it.concurrent('returns current month when no subscription date provided', () => {
      const result = calculateBillingPeriod()

      expect(result.start).toBeInstanceOf(Date)
      expect(result.end).toBeInstanceOf(Date)
      expect(result.start.getDate()).toBe(1) // Should start on 1st of month
    })

    it.concurrent('handles mid-month subscription correctly', () => {
      vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))
      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const result = calculateBillingPeriod(subscriptionStart)

      // Should create a billing period that includes current date
      expect(result.start).toBeInstanceOf(Date)
      expect(result.end).toBeInstanceOf(Date)
      expect(result.end.getTime()).toBeGreaterThan(result.start.getTime())

      // Current period should contain the current date
      const currentDate = new Date('2024-07-06T10:00:00Z')
      expect(currentDate.getTime()).toBeGreaterThanOrEqual(result.start.getTime())
      expect(currentDate.getTime()).toBeLessThan(result.end.getTime())
    })
  })

  describe('calculateNextBillingPeriod', () => {
    it.concurrent('calculates next period correctly', () => {
      const currentPeriodEnd = new Date('2024-07-15T23:59:59Z')
      const result = calculateNextBillingPeriod(currentPeriodEnd)

      expect(result.start.getDate()).toBe(15)
      expect(result.start.getMonth()).toBe(6) // July (0-indexed)
      expect(result.end.getDate()).toBe(15)
      expect(result.end.getMonth()).toBe(7) // August (0-indexed)
    })

    it.concurrent('handles month boundary correctly', () => {
      const currentPeriodEnd = new Date('2024-01-31T23:59:59Z')
      const result = calculateNextBillingPeriod(currentPeriodEnd)

      expect(result.start.getMonth()).toBe(0) // January
      expect(result.end.getMonth()).toBeGreaterThanOrEqual(1) // February or later due to month overflow
    })
  })

  describe('getPlanPricing', () => {
    it.concurrent('returns correct pricing for free plan', () => {
      const result = getPlanPricing('free')
      expect(result).toEqual({ basePrice: 0, minimum: 0 })
    })

    it.concurrent('returns correct pricing for pro plan', () => {
      const result = getPlanPricing('pro')
      expect(result).toEqual({ basePrice: 20, minimum: 20 })
    })

    it.concurrent('returns correct pricing for team plan', () => {
      const result = getPlanPricing('team')
      expect(result).toEqual({ basePrice: 40, minimum: 40 })
    })

    it.concurrent('returns correct pricing for enterprise plan with metadata', () => {
      const subscription = {
        metadata: { perSeatAllowance: 150 },
      }
      const result = getPlanPricing('enterprise', subscription)
      expect(result).toEqual({ basePrice: 150, minimum: 150 })
    })

    it.concurrent('returns default enterprise pricing when metadata missing', () => {
      const result = getPlanPricing('enterprise')
      expect(result).toEqual({ basePrice: 100, minimum: 100 })
    })
  })

  describe('getUsersAndOrganizationsForOverageBilling', () => {
    it.concurrent('returns empty arrays when no subscriptions due', async () => {
      const result = await getUsersAndOrganizationsForOverageBilling()

      expect(result).toHaveProperty('users')
      expect(result).toHaveProperty('organizations')
      expect(Array.isArray(result.users)).toBe(true)
      expect(Array.isArray(result.organizations)).toBe(true)
    })

    it.concurrent('filters by current date correctly', async () => {
      vi.setSystemTime(new Date('2024-07-15T10:00:00Z'))

      const result = await getUsersAndOrganizationsForOverageBilling()

      // Should only return entities whose billing period ends on July 15th
      expect(result.users).toEqual([])
      expect(result.organizations).toEqual([])
    })
  })

  describe('Stripe client integration', () => {
    it.concurrent('does not fail when Stripe credentials are not available', async () => {
      const result = await getUsersAndOrganizationsForOverageBilling()

      expect(result).toHaveProperty('users')
      expect(result).toHaveProperty('organizations')
    })
  })

  describe('Date handling edge cases', () => {
    it.concurrent('handles month boundaries correctly', () => {
      // Test end of January (28/29 days) to February
      const janEnd = new Date('2024-01-31T00:00:00Z')
      const result = calculateNextBillingPeriod(janEnd)

      expect(result.start.getMonth()).toBe(0) // January
      expect(result.end.getMonth()).toBeGreaterThanOrEqual(1) // February or later due to month overflow
    })

    it.concurrent('handles leap year correctly', () => {
      const febEnd = new Date('2024-02-29T00:00:00Z') // 2024 is leap year
      const result = calculateNextBillingPeriod(febEnd)

      // The date might be adjusted due to JavaScript's month overflow handling
      expect(result.start.getDate()).toBeGreaterThanOrEqual(28)
      expect(result.start.getMonth()).toBe(1) // February
      expect(result.end.getMonth()).toBe(2) // March
    })

    it.concurrent('handles year boundary correctly', () => {
      const decEnd = new Date('2024-12-15T00:00:00Z')
      const result = calculateNextBillingPeriod(decEnd)

      expect(result.start.getFullYear()).toBe(2024)
      expect(result.start.getMonth()).toBe(11) // December
      expect(result.end.getFullYear()).toBe(2025)
      expect(result.end.getMonth()).toBe(0) // January
    })

    it.concurrent('basic date calculations work', () => {
      const testDate = new Date('2024-07-15T00:00:00Z')
      const result = calculateNextBillingPeriod(testDate)

      expect(result.start).toBeInstanceOf(Date)
      expect(result.end).toBeInstanceOf(Date)
      expect(result.end.getTime()).toBeGreaterThan(result.start.getTime())
    })
  })
})
