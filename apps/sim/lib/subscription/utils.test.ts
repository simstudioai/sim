import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calculateUsageLimit, checkEnterprisePlan } from './utils'

const ORIGINAL_ENV = { ...process.env }

beforeAll(() => {
  process.env.FREE_TIER_COST_LIMIT = '5'
  process.env.PRO_TIER_COST_LIMIT = '20'
  process.env.TEAM_TIER_COST_LIMIT = '40'
  process.env.ENTERPRISE_TIER_COST_LIMIT = '200'
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

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

  describe('calculateUsageLimit', () => {
    it.concurrent('returns free-tier limit when subscription is null', () => {
      expect(calculateUsageLimit(null)).toBe(5)
    })

    it.concurrent('returns free-tier limit when subscription is undefined', () => {
      expect(calculateUsageLimit(undefined)).toBe(5)
    })

    it.concurrent('returns free-tier limit when subscription is not active', () => {
      expect(calculateUsageLimit({ plan: 'pro', status: 'canceled', seats: 1 })).toBe(5)
    })

    it.concurrent('returns pro limit for active pro plan', () => {
      expect(calculateUsageLimit({ plan: 'pro', status: 'active', seats: 1 })).toBe(20)
    })

    it.concurrent('returns team limit multiplied by seats', () => {
      expect(calculateUsageLimit({ plan: 'team', status: 'active', seats: 3 })).toBe(3 * 40)
    })

    it.concurrent('returns enterprise limit using perSeatAllowance metadata', () => {
      const sub = {
        plan: 'enterprise',
        status: 'active',
        seats: 10,
        metadata: { perSeatAllowance: '150' },
      }
      expect(calculateUsageLimit(sub)).toBe(10 * 150)
    })

    it.concurrent('returns enterprise limit using totalAllowance metadata', () => {
      const sub = {
        plan: 'enterprise',
        status: 'active',
        seats: 8,
        metadata: { totalAllowance: '5000' },
      }
      expect(calculateUsageLimit(sub)).toBe(5000)
    })

    it.concurrent('falls back to default enterprise tier when metadata missing', () => {
      const sub = { plan: 'enterprise', status: 'active', seats: 2, metadata: {} }
      expect(calculateUsageLimit(sub)).toBe(2 * 200)
    })
  })
})
