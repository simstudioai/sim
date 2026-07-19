import {
  DEFAULT_BILLING_CONCURRENCY_LIMITS,
  parseBillingConcurrencyLimit,
} from '@/lib/billing/concurrency-defaults'
import { getPlanTypeForLimits, type PlanCategory } from '@/lib/billing/plan-helpers'
import { env, envNumber } from '@/lib/core/config/env'

function configuredConcurrencyLimit(value: number | string | undefined, fallback: number): number {
  const parsed = envNumber(value, fallback, { min: 1, integer: true })
  return parseBillingConcurrencyLimit(parsed) ?? fallback
}

/**
 * Resolves operator-configured defaults for every plan limit category.
 */
export function getBillingConcurrencyLimits(): Record<PlanCategory, number> {
  return {
    free: configuredConcurrencyLimit(
      env.BILLING_CONCURRENCY_LIMIT_FREE,
      DEFAULT_BILLING_CONCURRENCY_LIMITS.free
    ),
    pro: configuredConcurrencyLimit(
      env.BILLING_CONCURRENCY_LIMIT_PRO,
      DEFAULT_BILLING_CONCURRENCY_LIMITS.pro
    ),
    team: configuredConcurrencyLimit(
      env.BILLING_CONCURRENCY_LIMIT_TEAM,
      DEFAULT_BILLING_CONCURRENCY_LIMITS.team
    ),
    enterprise: configuredConcurrencyLimit(
      env.BILLING_CONCURRENCY_LIMIT_ENTERPRISE,
      DEFAULT_BILLING_CONCURRENCY_LIMITS.enterprise
    ),
  }
}

/**
 * Resolves one payer's concurrency ceiling. A valid Enterprise subscription
 * metadata override takes precedence over the deployment-wide default.
 */
export function getBillingConcurrencyLimit(
  plan: string | null | undefined,
  enterpriseConcurrencyLimit?: number | null
): number {
  const planType = getPlanTypeForLimits(plan)
  if (planType === 'enterprise') {
    const customLimit = parseBillingConcurrencyLimit(enterpriseConcurrencyLimit)
    if (customLimit !== null) return customLimit
  }
  return getBillingConcurrencyLimits()[planType]
}
