/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveCostMultiplier } from '@/lib/core/config/cost-multiplier'

describe('resolveCostMultiplier', () => {
  it('normalizes the raw string env value in production', () => {
    // skipValidation leaves COST_MULTIPLIER as the string it was deployed with; the
    // sandbox lease's finite check rejected it and every run_code on dev failed to boot.
    expect(resolveCostMultiplier('1.5', true)).toBe(1.5)
    expect(resolveCostMultiplier(2, true)).toBe(2)
  })

  it('falls back to 1 for an unset or invalid value, and outside production', () => {
    expect(resolveCostMultiplier(undefined, true)).toBe(1)
    expect(resolveCostMultiplier('abc', true)).toBe(1)
    expect(resolveCostMultiplier('-3', true)).toBe(1)
    expect(resolveCostMultiplier('1.5', false)).toBe(1)
  })
})
