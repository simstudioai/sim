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

vi.mock('@/lib/logs/console/logger', () => ({
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
    it.concurrent('calculates billing period from subscription dates correctly', () => {
      vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))
      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const subscriptionEnd = new Date('2024-08-15T00:00:00Z')
      const result = calculateBillingPeriod(subscriptionStart, subscriptionEnd)

      // Should return the current subscription period since we're within it
      expect(result.start).toEqual(subscriptionStart)
      expect(result.end).toEqual(subscriptionEnd)
      expect(result.start.getUTCDate()).toBe(15) // Should preserve day from subscription
      expect(result.end.getUTCDate()).toBe(15)
    })

    it.concurrent('calculates next period when current subscription period has ended', () => {
      vi.setSystemTime(new Date('2024-08-20T10:00:00Z')) // After subscription end
      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const subscriptionEnd = new Date('2024-08-15T00:00:00Z') // Already ended
      const result = calculateBillingPeriod(subscriptionStart, subscriptionEnd)

      // Should calculate next period starting from subscription end
      expect(result.start).toEqual(subscriptionEnd)
      expect(result.end.getUTCFullYear()).toBe(2024)
      expect(result.end.getUTCMonth()).toBe(8) // September (0-indexed)
      expect(result.end.getUTCDate()).toBe(15) // Should preserve day
    })

    it.concurrent('returns current month when no subscription date provided', () => {
      vi.setSystemTime(new Date('2024-07-15T10:00:00Z'))
      const result = calculateBillingPeriod()

      // Should return current calendar month (1st to last day of current month)
      expect(result.start.getUTCFullYear()).toBe(2024)
      expect(result.start.getUTCMonth()).toBe(6) // July (0-indexed)
      expect(result.start.getUTCDate()).toBe(1) // Should start on 1st of month
      expect(result.end.getUTCFullYear()).toBe(2024)
      expect(result.end.getUTCMonth()).toBe(6) // July (0-indexed) - ends on last day of current month
      expect(result.end.getUTCDate()).toBe(31) // Should end on last day of July
      expect(result.end.getUTCHours()).toBe(23) // Should end at 23:59:59.999
      expect(result.end.getUTCMinutes()).toBe(59)
      expect(result.end.getUTCSeconds()).toBe(59)
    })

    it.concurrent('handles subscription anniversary date correctly', () => {
      vi.setSystemTime(new Date('2024-07-06T10:00:00Z'))
      const subscriptionStart = new Date('2024-01-15T00:00:00Z')
      const subscriptionEnd = new Date('2024-07-15T00:00:00Z')
      const result = calculateBillingPeriod(subscriptionStart, subscriptionEnd)

      // Should maintain the 15th as billing day
      expect(result.start.getUTCDate()).toBe(15)
      expect(result.end.getUTCDate()).toBe(15)

      // Current period should contain the current date (July 6)
      const currentDate = new Date('2024-07-06T10:00:00Z')
      expect(currentDate.getTime()).toBeGreaterThanOrEqual(result.start.getTime())
      expect(currentDate.getTime()).toBeLessThan(result.end.getTime())
    })
  })

  describe('calculateNextBillingPeriod', () => {
    it.concurrent('calculates next period correctly', () => {
      const currentPeriodEnd = new Date('2024-07-15T23:59:59Z')
      const result = calculateNextBillingPeriod(currentPeriodEnd)

      expect(result.start.getUTCDate()).toBe(15)
      expect(result.start.getUTCMonth()).toBe(6) // July (0-indexed)
      expect(result.end.getUTCDate()).toBe(15)
      expect(result.end.getUTCMonth()).toBe(7) // August (0-indexed)
    })

    it.concurrent('handles month boundary correctly', () => {
      const currentPeriodEnd = new Date('2024-01-31T23:59:59Z')
      const result = calculateNextBillingPeriod(currentPeriodEnd)

      expect(result.start.getUTCMonth()).toBe(0) // January
      expect(result.end.getUTCMonth()).toBeGreaterThanOrEqual(1) // February or later due to month overflow
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

    it.concurrent('handles invalid perSeatAllowance values - negative number', () => {
      const subscription = {
        metadata: { perSeatAllowance: -50 },
      }
      const result = getPlanPricing('enterprise', subscription)
      // Should fall back to default enterprise pricing
      expect(result).toEqual({ basePrice: 100, minimum: 100 })
    })

    it.concurrent('handles invalid perSeatAllowance values - zero', () => {
      const subscription = {
        metadata: { perSeatAllowance: 0 },
      }
      const result = getPlanPricing('enterprise', subscription)
      // Should fall back to default enterprise pricing
      expect(result).toEqual({ basePrice: 100, minimum: 100 })
    })

    it.concurrent('handles invalid perSeatAllowance values - non-numeric string', () => {
      const subscription = {
        metadata: { perSeatAllowance: 'invalid' },
      }
      const result = getPlanPricing('enterprise', subscription)
      // Should fall back to default enterprise pricing
      expect(result).toEqual({ basePrice: 100, minimum: 100 })
    })

    it.concurrent('handles invalid perSeatAllowance values - null', () => {
      const subscription = {
        metadata: { perSeatAllowance: null },
      }
      const result = getPlanPricing('enterprise', subscription)
      // Should fall back to default enterprise pricing
      expect(result).toEqual({ basePrice: 100, minimum: 100 })
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

      expect(result.start.getUTCMonth()).toBe(0) // January
      expect(result.end.getUTCMonth()).toBeGreaterThanOrEqual(1) // February or later due to month overflow
    })

    it.concurrent('handles leap year correctly', () => {
      const febEnd = new Date('2024-02-29T00:00:00Z')
      const result = calculateNextBillingPeriod(febEnd)

      expect(result.start.getUTCFullYear()).toBe(2024)
      expect(result.start.getUTCMonth()).toBe(1)
      expect(result.start.getUTCDate()).toBe(29)
      expect(result.end.getUTCFullYear()).toBe(2024)
      expect(result.end.getUTCMonth()).toBe(2)
      expect(result.end.getUTCDate()).toBe(29)
    })

    it.concurrent('handles year boundary correctly', () => {
      const decEnd = new Date('2024-12-15T00:00:00Z')
      const result = calculateNextBillingPeriod(decEnd)

      expect(result.start.getUTCFullYear()).toBe(2024)
      expect(result.start.getUTCMonth()).toBe(11) // December
      expect(result.end.getUTCFullYear()).toBe(2025)
      expect(result.end.getUTCMonth()).toBe(0) // January
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
