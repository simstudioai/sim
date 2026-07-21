import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import { getPlanTierCredits, getPlanTierDollars, isTeam } from '@/lib/billing/plan-helpers'
import { Decimal, toDecimal } from '@/lib/billing/utils/decimal'

export interface TeamOrganizationEconomics {
  seats: number
  planAllowanceDollars: number
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
    planAllowanceDollars: (getPlanTierCredits(plan) * seats) / CREDIT_MULTIPLIER,
    monthlyInvoiceAmountUsd: getPlanTierDollars(plan) * seats,
  }
}

/**
 * Fallback for a legacy organization whose stored usage limit is null.
 * Existing prepaid residuals remain exact; callers add the new grant delta to
 * this value in the same SQL update that increments the prepaid balance.
 */
export function getOrganizationUsageLimitFallbackDollars(params: {
  creditBalanceDollarsBeforeGrant: string | number
  planAllowanceDollars: number
  configuredUsageLimitDollars: number | null
}): string {
  const configuredUsageLimitDollars =
    params.configuredUsageLimitDollars === null
      ? toDecimal(0)
      : toDecimal(params.configuredUsageLimitDollars)
  const planAllowanceDollars = toDecimal(params.planAllowanceDollars)
  return Decimal.max(configuredUsageLimitDollars, planAllowanceDollars)
    .plus(toDecimal(params.creditBalanceDollarsBeforeGrant))
    .toString()
}
