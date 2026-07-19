/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'

describe('getPlanTypeForLimits', () => {
  it.each([
    ['pro_6000', 'pro'],
    ['team_6000', 'pro'],
    ['pro_25000', 'team'],
    ['team_25000', 'team'],
  ] as const)('buckets modern plan %s by paid tier into %s', (plan, expected) => {
    expect(getPlanTypeForLimits(plan)).toBe(expected)
  })

  it('keeps legacy pro and team plan names in their original categories', () => {
    expect(getPlanTypeForLimits('pro')).toBe('pro')
    expect(getPlanTypeForLimits('team')).toBe('team')
  })

  it('maps enterprise, free, and unknown plans unchanged', () => {
    expect(getPlanTypeForLimits('enterprise')).toBe('enterprise')
    expect(getPlanTypeForLimits('free')).toBe('free')
    expect(getPlanTypeForLimits(undefined)).toBe('free')
    expect(getPlanTypeForLimits('unrecognized')).toBe('free')
  })
})
