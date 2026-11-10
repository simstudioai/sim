import { describe, expect, it } from 'vitest'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import {
  getCoveredUsage,
  getIsOnDemandActive,
  getOnDemandOffLimit,
  isOnDemandOffDisabled,
} from '@/lib/billing/on-demand'

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

describe('isOnDemandOffDisabled', () => {
  it('disables the toggle when on-demand is on and usage is above covered', () => {
    // Turning off here would re-cap at usage (150) and bounce back on, so lock it.
    expect(
      isOnDemandOffDisabled({ isOnDemandActive: true, effectiveCurrentUsage: 150, covered: 120 })
    ).toBe(true)
  })

  it('allows turning off when usage is at or below covered', () => {
    expect(
      isOnDemandOffDisabled({ isOnDemandActive: true, effectiveCurrentUsage: 120, covered: 120 })
    ).toBe(false)
    expect(
      isOnDemandOffDisabled({ isOnDemandActive: true, effectiveCurrentUsage: 62, covered: 120 })
    ).toBe(false)
  })

  it('never disables when on-demand is already off (turning on stays allowed)', () => {
    expect(
      isOnDemandOffDisabled({ isOnDemandActive: false, effectiveCurrentUsage: 150, covered: 120 })
    ).toBe(false)
  })
})
