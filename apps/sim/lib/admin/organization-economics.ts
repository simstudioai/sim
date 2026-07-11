import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import { getPlanTierCredits, getPlanTierDollars, isTeam } from '@/lib/billing/plan-helpers'
import { Decimal, toDecimal } from '@/lib/billing/utils/decimal'

export interface TeamOrganizationEconomics {
  seats: number
  includedMonthlyCredits: number
  monthlyInvoiceAmountUsd: number
}

/** Canonical pooled Team allowance and invoice amount (`per-seat × members`). */
export function getTeamOrganizationEconomics(
  plan: string | null | undefined,
  internalMemberCount: number
): TeamOrganizationEconomics | null {
  if (!plan || !isTeam(plan)) return null
  const seats = Math.max(0, Math.trunc(internalMemberCount))
  return {
    seats,
    includedMonthlyCredits: getPlanTierCredits(plan) * seats,
    monthlyInvoiceAmountUsd: getPlanTierDollars(plan) * seats,
  }
}

/** Exact numeric dollar delta for an integer credit grant. */
export function creditGrantDollars(grantedCredits: number): string {
  return toDecimal(grantedCredits).div(CREDIT_MULTIPLIER).toString()
}

/**
 * Fallback for a legacy organization whose stored usage limit is null.
 * Existing prepaid residuals remain exact; callers add the new grant delta to
 * this value in the same SQL update that increments the prepaid balance.
 */
export function getOrganizationUsageLimitFallbackDollars(params: {
  creditBalanceDollarsBeforeGrant: string | number
  includedCredits: number
  configuredUsageLimitCredits: number | null
}): string {
  const configuredUsageLimitDollars =
    params.configuredUsageLimitCredits === null
      ? toDecimal(0)
      : toDecimal(params.configuredUsageLimitCredits).div(CREDIT_MULTIPLIER)
  const includedUsageLimitDollars = toDecimal(params.includedCredits).div(CREDIT_MULTIPLIER)
  return Decimal.max(configuredUsageLimitDollars, includedUsageLimitDollars)
    .plus(toDecimal(params.creditBalanceDollarsBeforeGrant))
    .toString()
}
