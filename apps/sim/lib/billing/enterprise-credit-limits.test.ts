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
          includedMonthlyCredits: '10000',
          usageLimitCredits: '20000',
        },
        monthlyPriceUsd: 999,
        prepaidBalanceDollars: 10,
      })
    ).toEqual({
      includedMonthlyCredits: 10000,
      configuredUsageLimitCredits: 20000,
      prepaidCredits: 2000,
      effectiveUsageLimitCredits: 22000,
      effectiveUsageLimitDollars: '110',
    })
  })

  it('uses the included allowance as the base when it exceeds configuration', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {
          includedMonthlyCredits: '10000',
          usageLimitCredits: '8000',
        },
        monthlyPriceUsd: 999,
        prepaidBalanceDollars: 10,
      }).effectiveUsageLimitCredits
    ).toBe(12000)
  })

  it('uses the legacy monthly-price allowance only when credit metadata is absent', () => {
    expect(
      deriveEnterpriseCreditLimits({
        metadata: {},
        monthlyPriceUsd: 50,
        prepaidBalanceDollars: 0,
      })
    ).toEqual({
      includedMonthlyCredits: 10000,
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
          includedMonthlyCredits: '20000',
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
