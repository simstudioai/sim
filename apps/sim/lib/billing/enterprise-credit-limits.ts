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
  const parsedUsageLimitCredits = Number(metadata.usageLimitCredits)
  const configuredUsageLimitCredits = Number.isFinite(parsedUsageLimitCredits)
    ? Math.max(0, Math.round(parsedUsageLimitCredits))
    : dollarsToCredits(monthlyPriceUsd)
  const prepaidBalance = toDecimal(prepaidBalanceDollars)
  const prepaidCredits = dollarsToCredits(prepaidBalance.toNumber())
  const effectiveUsageLimitDollars = toDecimal(configuredUsageLimitCredits)
    .div(CREDIT_MULTIPLIER)
    .plus(prepaidBalance)
    .toString()
  const effectiveUsageLimitCredits = dollarsToCredits(Number(effectiveUsageLimitDollars))

  return {
    configuredUsageLimitCredits,
    prepaidCredits,
    effectiveUsageLimitCredits,
    effectiveUsageLimitDollars,
  }
}
