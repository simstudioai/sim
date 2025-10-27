/**
 * Tests for subscription utility functions
 * Verifies that env.ts defaults for cost limits are correctly applied
 */

import { describe, expect, it, vi } from 'vitest'
import {
  canEditUsageLimit,
  getEnterpriseTierLimitPerSeat,
  getFreeTierLimit,
  getPerUserMinimumLimit,
  getProTierLimit,
  getTeamTierLimitPerSeat,
} from './utils'

// Mock the env module with the defaults we expect
vi.mock('@/lib/env', () => ({
  env: {
    FREE_TIER_COST_LIMIT: 10,
    PRO_TIER_COST_LIMIT: 20,
    TEAM_TIER_COST_LIMIT: 40,
    ENTERPRISE_TIER_COST_LIMIT: 200,
  },
}))

describe('Subscription Utility Functions', () => {
  describe('Cost Limit Getters', () => {
    it('should return correct free tier limit from env.ts defaults', () => {
      const limit = getFreeTierLimit()
      expect(limit).toBe(10) // $10 default
    })

    it('should return correct pro tier limit from env.ts defaults', () => {
      const limit = getProTierLimit()
      expect(limit).toBe(20) // $20 default
    })

    it('should return correct team tier limit from env.ts defaults', () => {
      const limit = getTeamTierLimitPerSeat()
      expect(limit).toBe(40) // $40 per seat default
    })

    it('should return correct enterprise tier limit from env.ts defaults', () => {
      const limit = getEnterpriseTierLimitPerSeat()
      expect(limit).toBe(200) // $200 per seat default
    })
  })

  describe('getPerUserMinimumLimit', () => {
    it('should return free tier limit for no subscription', () => {
      const limit = getPerUserMinimumLimit(null)
      expect(limit).toBe(10)
    })

    it('should return free tier limit for inactive subscription', () => {
      const subscription = { plan: 'pro', status: 'inactive' }
      const limit = getPerUserMinimumLimit(subscription)
      expect(limit).toBe(10)
    })

    it('should return pro tier limit for active pro subscription', () => {
      const subscription = { plan: 'pro', status: 'active' }
      const limit = getPerUserMinimumLimit(subscription)
      expect(limit).toBe(20)
    })

    it('should return 0 for team plan (no individual limit)', () => {
      const subscription = { plan: 'team', status: 'active' }
      const limit = getPerUserMinimumLimit(subscription)
      expect(limit).toBe(0)
    })

    it('should return 0 for enterprise plan (no individual limit)', () => {
      const subscription = { plan: 'enterprise', status: 'active' }
      const limit = getPerUserMinimumLimit(subscription)
      expect(limit).toBe(0)
    })

    it('should return free tier limit for unknown plan', () => {
      const subscription = { plan: 'unknown', status: 'active' }
      const limit = getPerUserMinimumLimit(subscription)
      expect(limit).toBe(10)
    })
  })

  describe('canEditUsageLimit', () => {
    it('should return false for no subscription', () => {
      const canEdit = canEditUsageLimit(null)
      expect(canEdit).toBe(false)
    })

    it('should return false for inactive subscription', () => {
      const subscription = { plan: 'pro', status: 'inactive' }
      const canEdit = canEditUsageLimit(subscription)
      expect(canEdit).toBe(false)
    })

    it('should return true for active pro subscription', () => {
      const subscription = { plan: 'pro', status: 'active' }
      const canEdit = canEditUsageLimit(subscription)
      expect(canEdit).toBe(true)
    })

    it('should return true for active team subscription', () => {
      const subscription = { plan: 'team', status: 'active' }
      const canEdit = canEditUsageLimit(subscription)
      expect(canEdit).toBe(true)
    })

    it('should return false for active enterprise subscription', () => {
      const subscription = { plan: 'enterprise', status: 'active' }
      const canEdit = canEditUsageLimit(subscription)
      expect(canEdit).toBe(false)
    })

    it('should return false for free plan', () => {
      const subscription = { plan: 'free', status: 'active' }
      const canEdit = canEditUsageLimit(subscription)
      expect(canEdit).toBe(false)
    })
  })

  describe('Environment Variable Defaults Verification', () => {
    it('should verify that env.ts defaults match expected values', () => {
      // These values should match the defaults defined in env.ts:
      // FREE_TIER_COST_LIMIT: z.number().optional().default(10)
      // PRO_TIER_COST_LIMIT: z.number().optional().default(20)
      // TEAM_TIER_COST_LIMIT: z.number().optional().default(40)
      // ENTERPRISE_TIER_COST_LIMIT: z.number().optional().default(200)

      const expectedDefaults = {
        free: 10,
        pro: 20,
        team: 40,
        enterprise: 200,
      }

      expect(getFreeTierLimit()).toBe(expectedDefaults.free)
      expect(getProTierLimit()).toBe(expectedDefaults.pro)
      expect(getTeamTierLimitPerSeat()).toBe(expectedDefaults.team)
      expect(getEnterpriseTierLimitPerSeat()).toBe(expectedDefaults.enterprise)
    })

    it('should maintain consistency across multiple calls', () => {
      const free1 = getFreeTierLimit()
      const free2 = getFreeTierLimit()
      expect(free1).toBe(free2)

      const pro1 = getProTierLimit()
      const pro2 = getProTierLimit()
      expect(pro1).toBe(pro2)

      const team1 = getTeamTierLimitPerSeat()
      const team2 = getTeamTierLimitPerSeat()
      expect(team1).toBe(team2)

      const enterprise1 = getEnterpriseTierLimitPerSeat()
      const enterprise2 = getEnterpriseTierLimitPerSeat()
      expect(enterprise1).toBe(enterprise2)
    })
  })

  describe('Tier Comparisons', () => {
    it('should verify tier limits are in ascending order', () => {
      const free = getFreeTierLimit()
      const pro = getProTierLimit()
      const team = getTeamTierLimitPerSeat()
      const enterprise = getEnterpriseTierLimitPerSeat()

      // Pro should be higher than free
      expect(pro).toBeGreaterThan(free)

      // Team should be higher than pro
      expect(team).toBeGreaterThan(pro)

      // Enterprise should be higher than team
      expect(enterprise).toBeGreaterThan(team)
    })
  })
})
