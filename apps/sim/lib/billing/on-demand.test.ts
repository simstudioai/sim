/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  getCoveredUsage,
  getIsOnDemandActive,
  getOnDemandOffLimit,
  getPooledCreditsRemaining,
} from '@/lib/billing/on-demand'

describe('getPooledCreditsRemaining', () => {
  it('returns limit minus usage, matching enforcement (usage >= limit blocks)', () => {
    expect(getPooledCreditsRemaining(120, 62)).toBe(58)
    expect(getPooledCreditsRemaining(30, 10)).toBe(20)
  })

  it('does not add the credit balance back (the double-count regression)', () => {
    // team_6000, 2 seats: planBase $60 + credits $60 → limit $120, usage ~$62.
    // Remaining is $58 ≈ 11,600 credits — NOT $118 ≈ 23,600 (limit + credits - usage).
    const remaining = getPooledCreditsRemaining(120, 62)
    expect(remaining).toBe(58)
    expect(dollarsToCredits(remaining)).toBe(11_600)
    expect(dollarsToCredits(remaining)).not.toBe(23_600)
  })

  it('clamps at zero when usage meets or exceeds the limit', () => {
    expect(getPooledCreditsRemaining(100, 100)).toBe(0)
    expect(getPooledCreditsRemaining(60, 100)).toBe(0)
  })

  it('short-circuits the unlimited sentinel to ∞ instead of subtracting usage', () => {
    expect(getPooledCreditsRemaining(ON_DEMAND_UNLIMITED, 500)).toBe(ON_DEMAND_UNLIMITED)
    expect(getPooledCreditsRemaining(ON_DEMAND_UNLIMITED + 1, 0)).toBe(ON_DEMAND_UNLIMITED)
  })
})

describe('getCoveredUsage', () => {
  it('sums the plan included amount and the goodwill credit balance', () => {
    expect(getCoveredUsage(60, 60)).toBe(120)
    expect(getCoveredUsage(30, 0)).toBe(30)
  })
})

describe('getIsOnDemandActive', () => {
  it('reads OFF when the limit only covers planBase + credits (credit grant is not on-demand)', () => {
    // The concrete regression case: limit == covered, so the toggle reads OFF.
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 60,
        effectiveUsageLimit: 120,
        covered: getCoveredUsage(60, 60),
      })
    ).toBe(false)
  })

  it('reads ON when the limit is raised above the covered ceiling', () => {
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 60,
        effectiveUsageLimit: ON_DEMAND_UNLIMITED,
        covered: getCoveredUsage(60, 60),
      })
    ).toBe(true)
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 60,
        effectiveUsageLimit: 121,
        covered: getCoveredUsage(60, 60),
      })
    ).toBe(true)
  })

  it('is never active for non-paid plans or a zero included allowance', () => {
    expect(
      getIsOnDemandActive({
        isPaid: false,
        planIncludedAmount: 60,
        effectiveUsageLimit: ON_DEMAND_UNLIMITED,
        covered: 120,
      })
    ).toBe(false)
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 0,
        effectiveUsageLimit: ON_DEMAND_UNLIMITED,
        covered: 0,
      })
    ).toBe(false)
  })

  it('behaves equivalently on the personal Pro path (no credits)', () => {
    const covered = getCoveredUsage(30, 0)
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 30,
        effectiveUsageLimit: 30,
        covered,
      })
    ).toBe(false)
    expect(
      getIsOnDemandActive({
        isPaid: true,
        planIncludedAmount: 30,
        effectiveUsageLimit: ON_DEMAND_UNLIMITED,
        covered,
      })
    ).toBe(true)
  })
})

describe('getOnDemandOffLimit', () => {
  it('drops the limit to the covered ceiling when usage is below it', () => {
    expect(getOnDemandOffLimit(62, 120)).toBe(120)
    expect(getOnDemandOffLimit(10, 30)).toBe(30)
  })

  it('never lowers the limit below current usage', () => {
    expect(getOnDemandOffLimit(150, 120)).toBe(150)
  })

  it('lands on covered when usage equals it', () => {
    expect(getOnDemandOffLimit(120, 120)).toBe(120)
  })
})
