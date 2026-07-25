/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deriveEnterpriseCreditLimits } from '@/lib/billing/enterprise-credit-limits'

describe('deriveEnterpriseCreditLimits', () => {
  it('adds prepaid credits above a higher configured usage base', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {
          invoiceAmountCents: '99900',
          usageLimitCredits: '20000',
        },
        monthlyPriceUsd: 999,
        prepaidBalanceDollars: 10,
      })
    ).toEqual({
      configuredUsageLimitCredits: 20000,
      prepaidCredits: 2000,
      effectiveUsageLimitCredits: 22000,
      effectiveUsageLimitDollars: '110',
    })
  })

  it('uses the configured usage limit without an invoice-derived floor', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {
          usageLimitCredits: '8000',
        },
        monthlyPriceUsd: 999,
        prepaidBalanceDollars: 10,
      }).effectiveUsageLimitCredits
    ).toBe(10000)
  })

  it('defaults the usage limit to the monthly price when metadata is absent', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {},
        monthlyPriceUsd: 50,
        prepaidBalanceDollars: 0,
      })
    ).toEqual({
      configuredUsageLimitCredits: 10000,
      prepaidCredits: 0,
      effectiveUsageLimitCredits: 10000,
      effectiveUsageLimitDollars: '50',
    })
  })

  it('preserves sub-credit prepaid residuals in the stored effective limit', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {
          usageLimitCredits: '20000',
        },
        monthlyPriceUsd: 100,
        prepaidBalanceDollars: '0.001',
      })
    ).toMatchObject({
      prepaidCredits: 0,
      effectiveUsageLimitCredits: 20000,
      effectiveUsageLimitDollars: '100.001',
    })
  })
})
