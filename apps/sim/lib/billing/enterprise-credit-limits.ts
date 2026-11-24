import { CREDIT_MULTIPLIER, dollarsToCredits } from '@/lib/billing/credits/conversion'
import { toDecimal } from '@/lib/billing/utils/decimal'

interface DeriveEnterpriseCreditLimitsInput {
  metadata: Record<string, string>
  invoiceAmountUsd: number
  prepaidBalanceDollars: string | number
}

/**
 * The credits an Enterprise contract includes each period, before prepaid credit or self-serve
 * overage: its configured limit, or the invoice amount a contract without one defaults to.
 */
export function configuredEnterpriseUsageCredits(
  usageLimitCredits: unknown,
  invoiceAmountUsd: number
): number {
  const parsedUsageLimitCredits = Number(usageLimitCredits)
  return Number.isFinite(parsedUsageLimitCredits)
    ? Math.max(0, Math.round(parsedUsageLimitCredits))
    : dollarsToCredits(invoiceAmountUsd)
}

export function deriveEnterpriseCreditLimits({
  metadata,
  invoiceAmountUsd,
  prepaidBalanceDollars,
}: DeriveEnterpriseCreditLimitsInput) {
  const configuredUsageLimitCredits = configuredEnterpriseUsageCredits(
    metadata.usageLimitCredits,
    invoiceAmountUsd
  )
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
