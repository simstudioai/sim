import { describe, expect, it, vi } from 'vitest'
import { checkEnterprisePlan, getSubscriptionAllowance } from '@/lib/billing/subscriptions/utils'

vi.mock('@/lib/env', () => ({
  env: {
    FREE_TIER_COST_LIMIT: 10,
    PRO_TIER_COST_LIMIT: 20,
    TEAM_TIER_COST_LIMIT: 40,
    ENTERPRISE_TIER_COST_LIMIT: 200,
  },
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
  getEnv: (variable: string) => process.env[variable],
}))

describe('Subscription Utilities', () => {
  describe('checkEnterprisePlan', () => {
    it.concurrent('returns true for active enterprise subscription', () => {
      expect(checkEnterprisePlan({ plan: 'enterprise', status: 'active' })).toBeTruthy()
    })

    it.concurrent('returns false for inactive enterprise subscription', () => {
      expect(checkEnterprisePlan({ plan: 'enterprise', status: 'canceled' })).toBeFalsy()
    })

    it.concurrent('returns false when plan is not enterprise', () => {
      expect(checkEnterprisePlan({ plan: 'pro', status: 'active' })).toBeFalsy()
    })
  })

  describe('getSubscriptionAllowance', () => {
    it.concurrent('returns free-tier limit when subscription is null', () => {
      expect(getSubscriptionAllowance(null)).toBe(10)
    })

    it.concurrent('returns free-tier limit when subscription is undefined', () => {
      expect(getSubscriptionAllowance(undefined)).toBe(10)
    })

    it.concurrent('returns free-tier limit when subscription is not active', () => {
      expect(getSubscriptionAllowance({ plan: 'pro', status: 'canceled', seats: 1 })).toBe(10)
    })

    it.concurrent('returns pro limit for active pro plan', () => {
      expect(getSubscriptionAllowance({ plan: 'pro', status: 'active', seats: 1 })).toBe(20)
    })

    it.concurrent('returns team limit multiplied by seats', () => {
      expect(getSubscriptionAllowance({ plan: 'team', status: 'active', seats: 3 })).toBe(3 * 40)
    })

    it.concurrent('returns enterprise limit using perSeatPrice metadata', () => {
      const sub = {
        plan: 'enterprise',
        status: 'active',
        seats: 10,
        metadata: { perSeatPrice: 150 },
      }
      expect(getSubscriptionAllowance(sub)).toBe(10 * 150)
    })

    it.concurrent('returns enterprise limit using perSeatPrice as string', () => {
      const sub = {
        plan: 'enterprise',
        status: 'active',
        seats: 8,
        metadata: { perSeatPrice: '250' },
      }
      expect(getSubscriptionAllowance(sub)).toBe(8 * 250)
    })

    it.concurrent('falls back to default enterprise tier when metadata missing', () => {
      const sub = { plan: 'enterprise', status: 'active', seats: 2, metadata: {} }
      expect(getSubscriptionAllowance(sub)).toBe(2 * 200)
    })
  })
})
