/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveModelTokenPricing } from '@/providers/pricing'
import type { ModelPricing } from '@/providers/types'

describe('resolveModelTokenPricing', () => {
  const pricing: ModelPricing = {
    input: 1,
    output: 2,
    tiers: [
      { aboveInputTokens: 100, input: 3, output: 4 },
      { aboveInputTokens: 1000, input: 5, output: 6 },
    ],
    updatedAt: '2026-09-04',
  }

  it('uses base pricing through the first threshold', () => {
    expect(resolveModelTokenPricing(pricing, 100)).toMatchObject({ input: 1, output: 2 })
  })

  it('uses the highest matching threshold regardless of declaration order', () => {
    const reversed = { ...pricing, tiers: [...(pricing.tiers ?? [])].reverse() }

    expect(resolveModelTokenPricing(reversed, 101)).toMatchObject({ input: 3, output: 4 })
    expect(resolveModelTokenPricing(reversed, 1001)).toMatchObject({ input: 5, output: 6 })
  })
})
