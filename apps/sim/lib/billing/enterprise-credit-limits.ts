import { CREDIT_MULTIPLIER, dollarsToCredits } from '@/lib/billing/credits/conversion'
import { toDecimal } from '@/lib/billing/utils/decimal'

interface DeriveEnterpriseCreditLimitsInput {
  metadata: Record<string, string>
  monthlyPriceUsd: number
  prepaidBalanceDollars: string | number
}

export function deriveEnterpriseCreditLimits({
  metadata,
  monthlyPriceUsd,
  prepaidBalanceDollars,
}: DeriveEnterpriseCreditLimitsInput) {
  const parsedIncludedCredits = Number(metadata.includedMonthlyCredits)
  const includedMonthlyCredits = Number.isFinite(parsedIncludedCredits)
    ? Math.max(0, Math.round(parsedIncludedCredits))
    : dollarsToCredits(monthlyPriceUsd)
  const parsedUsageLimitCredits = Number(metadata.usageLimitCredits)
  const configuredUsageLimitCredits = Number.isFinite(parsedUsageLimitCredits)
    ? Math.max(0, Math.round(parsedUsageLimitCredits))
    : includedMonthlyCredits
  const prepaidBalance = toDecimal(prepaidBalanceDollars)
  const prepaidCredits = dollarsToCredits(prepaidBalance.toNumber())
  const effectiveUsageLimitDollars = toDecimal(
    Math.max(configuredUsageLimitCredits, includedMonthlyCredits)
  )
    .div(CREDIT_MULTIPLIER)
    .plus(prepaidBalance)
    .toString()
  const effectiveUsageLimitCredits = dollarsToCredits(Number(effectiveUsageLimitDollars))

  return {
    includedMonthlyCredits,
    configuredUsageLimitCredits,
    prepaidCredits,
    effectiveUsageLimitCredits,
    effectiveUsageLimitDollars,
  }
}
