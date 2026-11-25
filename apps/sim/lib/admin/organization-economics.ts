import { getPlanTierDollars, isTeam } from '@/lib/billing/plan-helpers'
import {
  getOrgIncludedUsageDollars,
  type OrgAllowanceInput,
} from '@/lib/billing/subscriptions/utils'
import { Decimal, toDecimal } from '@/lib/billing/utils/decimal'

export interface TeamOrganizationEconomics {
  seats: number
  planAllowanceDollars: number
  monthlyInvoiceAmountUsd: number
}

/**
 * Canonical pooled Team allowance for the billing period (`per-seat × members`, a year's worth on
 * annual billing) and the monthly invoice amount.
 */
export function getTeamOrganizationEconomics(
  subscription: OrgAllowanceInput | undefined,
  internalMemberCount: number
): TeamOrganizationEconomics | null {
  const plan = subscription?.plan
  if (!subscription || !plan || !isTeam(plan)) return null
  const seats = Math.max(0, Math.trunc(internalMemberCount))
  return {
    seats,
    planAllowanceDollars: seats === 0 ? 0 : getOrgIncludedUsageDollars({ ...subscription, seats }),
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
