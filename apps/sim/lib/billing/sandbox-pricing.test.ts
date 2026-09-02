/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NODE_ENV', 'production')
})

vi.unmock('@/lib/core/config/env-flags')

import { createSandboxPricing, priceSandboxUsage } from '@/lib/billing/sandbox-pricing'

afterEach(resetEnvMock)
afterAll(() => vi.unstubAllEnvs())

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

  describe('default multiplier from the production environment', () => {
    it('coerces the string COST_MULTIPLIER that process.env delivers', () => {
      setEnv({ COST_MULTIPLIER: '1.1' })

      const pricing = createSandboxPricing('e2b')

      expect(pricing.multiplier).toBe(1.1)
      expect(priceSandboxUsage(pricing, 1000, 1000).billedCost).toBeCloseTo(0.0000506, 8)
    })

    it('falls back to 1 when COST_MULTIPLIER is unset', () => {
      setEnv({ COST_MULTIPLIER: undefined })

      expect(createSandboxPricing('daytona').multiplier).toBe(1)
    })

    it('falls back to 1 instead of throwing when COST_MULTIPLIER is not a nonnegative number', () => {
      setEnv({ COST_MULTIPLIER: 'abc' })
      expect(createSandboxPricing('e2b').multiplier).toBe(1)

      setEnv({ COST_MULTIPLIER: '-2' })
      expect(createSandboxPricing('e2b').multiplier).toBe(1)
    })
  })
})
