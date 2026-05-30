/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  apportionCredits,
  dollarsToCredits,
  formatCreditCost,
} from '@/lib/billing/credits/conversion'

describe('formatCreditCost', () => {
  it('renders multiplier-inclusive dollars as a single-rounded credit label', () => {
    expect(formatCreditCost(0.005)).toBe('1 credit')
    expect(formatCreditCost(0.03141848)).toBe('6 credits')
    expect(formatCreditCost(1.234)).toBe('247 credits')
  })

  it('distinguishes sub-credit charges from zero', () => {
    expect(formatCreditCost(0.001)).toBe('<1 credit')
    expect(formatCreditCost(0)).toBe('0 credits')
  })

  it('honors emptyForZeroOrLess for the trace view contract', () => {
    expect(formatCreditCost(0, { emptyForZeroOrLess: true })).toBeUndefined()
    expect(formatCreditCost(undefined, { emptyForZeroOrLess: true })).toBeUndefined()
    expect(formatCreditCost(undefined)).toBe('—')
  })
})

describe('apportionCredits', () => {
  it('keeps line items summing exactly to the rounded total (no round-then-sum drift)', () => {
    // Real execution 43ef064d: base + 2x model, multiplier already applied.
    // Round-then-sum would give 1 + 4 + 2 = 7; the true total is 6.
    const credits = apportionCredits([
      { key: 'base', dollars: 0.005 },
      { key: 'input', dollars: 0.018798 },
      { key: 'output', dollars: 0.00762 },
      { key: 'tool', dollars: 0 },
    ])

    const total = dollarsToCredits(0.005 + 0.018798 + 0.00762 + 0)
    expect(total).toBe(6)
    expect(credits.base + credits.input + credits.output + credits.tool).toBe(total)
    expect(credits.base).toBe(1)
  })

  it('handles all-zero components', () => {
    const credits = apportionCredits([
      { key: 'base', dollars: 0 },
      { key: 'model', dollars: 0 },
    ])
    expect(credits.base + credits.model).toBe(0)
  })

  it('ignores negative/non-finite components without throwing', () => {
    const credits = apportionCredits([
      { key: 'base', dollars: 0.005 },
      { key: 'model', dollars: Number.NaN },
      { key: 'tool', dollars: -1 },
    ])
    expect(credits.base).toBe(1)
    expect(credits.model).toBe(0)
    expect(credits.tool).toBe(0)
  })
})
