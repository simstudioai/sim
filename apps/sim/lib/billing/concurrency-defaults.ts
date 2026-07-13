import type { PlanCategory } from '@/lib/billing/plan-helpers'

/**
 * Hosted product defaults for in-flight workflow executions per billing
 * account. Buckets follow the paid tier: `pro` covers Pro and Pro for Teams,
 * and `team` is the Max tier covering Max and Max for Teams.
 */
export const DEFAULT_BILLING_CONCURRENCY_LIMITS = {
  free: 10,
  pro: 50,
  team: 200,
  enterprise: 1000,
} as const satisfies Record<PlanCategory, number>

/** Safety ceiling for operator and Enterprise subscription overrides. */
export const MAX_BILLING_CONCURRENCY_LIMIT = 10_000

/**
 * Parses a positive execution-concurrency limit within the Redis safety bound.
 */
export function parseBillingConcurrencyLimit(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_BILLING_CONCURRENCY_LIMIT
    ? parsed
    : null
}
