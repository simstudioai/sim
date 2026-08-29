import { describe, expect, it } from 'vitest'
import { createSandboxPricing, priceSandboxUsage } from '@/lib/billing/sandbox-pricing'

describe('sandbox pricing', () => {
  it.each([
    ['e2b', 0.1656],
    ['daytona', 0.16668],
  ] as const)('prices one hour of the Function profile on %s', (provider, expected) => {
    const pricing = createSandboxPricing(provider, 1)

    expect(priceSandboxUsage(pricing, 3_600_000, 3_600_000).rawCost).toBeCloseTo(expected, 8)
  })

  it('applies the multiplier once and rounds the final cost to eight decimals', () => {
    const pricing = createSandboxPricing('e2b', 1.75)

    expect(priceSandboxUsage(pricing, 1234, 10_000).billedCost).toBe(0.00009934)
  })

  it('caps duration at the provider lifetime', () => {
    const pricing = createSandboxPricing('daytona', 1)

    expect(priceSandboxUsage(pricing, 90_000, 60_000).durationMs).toBe(60_000)
  })

  it('allows a zero multiplier and rejects invalid multipliers', () => {
    const freePricing = createSandboxPricing('e2b', 0)

    expect(priceSandboxUsage(freePricing, 1000, 1000).billedCost).toBe(0)
    expect(() => createSandboxPricing('e2b', -1)).toThrow('finite nonnegative')
    expect(() => createSandboxPricing('e2b', Number.NaN)).toThrow('finite nonnegative')
    expect(() => createSandboxPricing('e2b', Number.POSITIVE_INFINITY)).toThrow(
      'finite nonnegative'
    )
  })
})
