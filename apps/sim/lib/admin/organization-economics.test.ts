import { describe, expect, it } from 'vitest'
import {
  getOrganizationUsageLimitFallbackDollars,
  getTeamOrganizationEconomics,
} from '@/lib/admin/organization-economics'

describe('getTeamOrganizationEconomics', () => {
  it('derives the pooled Pro allowance and invoice from internal seats', () => {
    expect(getTeamOrganizationEconomics('team_6000', 3)).toEqual({
      seats: 3,
      includedMonthlyDollars: 90,
      monthlyInvoiceAmountUsd: 75,
    })
  })

  it('derives the pooled Max allowance and invoice from internal seats', () => {
    expect(getTeamOrganizationEconomics('team_25000', 2)).toEqual({
      seats: 2,
      includedMonthlyDollars: 250,
      monthlyInvoiceAmountUsd: 200,
    })
  })

  it('does not invent pricing for non-Team plans', () => {
    expect(getTeamOrganizationEconomics('enterprise', 5)).toBeNull()
  })
})

describe('getOrganizationUsageLimitFallbackDollars', () => {
  it('preserves an existing sub-credit prepaid residual in the fallback', () => {
    expect(
      getOrganizationUsageLimitFallbackDollars({
        creditBalanceDollarsBeforeGrant: '0.001',
        includedDollars: 0,
        configuredUsageLimitDollars: 0,
      })
    ).toBe('0.001')
  })

  it('adds the full existing prepaid balance above a higher configured base', () => {
    expect(
      getOrganizationUsageLimitFallbackDollars({
        creditBalanceDollarsBeforeGrant: '1.259567',
        includedDollars: 5,
        configuredUsageLimitDollars: 100,
      })
    ).toBe('101.259567')
  })
})
