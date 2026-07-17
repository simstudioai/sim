import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import { env, envNumber } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

/**
 * Default table dispatch concurrency — how many rows one table run executes
 * in parallel (the dispatcher window size). Free vs paid (Pro, Max,
 * Enterprise); overridable via `TABLE_DISPATCH_CONCURRENCY_{FREE,PAID}`.
 */
export const DEFAULT_TABLE_DISPATCH_CONCURRENCY = {
  free: 20,
  paid: 50,
} as const

/**
 * Resolves dispatch concurrency limits, applying env overrides on top of the
 * defaults.
 */
export function getTableDispatchConcurrencyLimits(): { free: number; paid: number } {
  return {
    free: envNumber(env.TABLE_DISPATCH_CONCURRENCY_FREE, DEFAULT_TABLE_DISPATCH_CONCURRENCY.free, {
      min: 1,
      integer: true,
    }),
    paid: envNumber(env.TABLE_DISPATCH_CONCURRENCY_PAID, DEFAULT_TABLE_DISPATCH_CONCURRENCY.paid, {
      min: 1,
      integer: true,
    }),
  }
}

/**
 * Dispatch concurrency for one payer plan. Billing-disabled deployments get
 * the paid value.
 */
export function getTableDispatchConcurrency(plan: string | null | undefined): number {
  const limits = getTableDispatchConcurrencyLimits()
  if (!isBillingEnabled) return limits.paid
  return getPlanTypeForLimits(plan) === 'free' ? limits.free : limits.paid
}

/**
 * Highest configured dispatch concurrency. The `workflow-group-cell`
 * trigger.dev queue cap derives from this so the server-side per-table
 * ceiling never throttles below a plan's window.
 */
export function getMaxTableDispatchConcurrency(): number {
  const limits = getTableDispatchConcurrencyLimits()
  return Math.max(limits.free, limits.paid)
}

/**
 * Resolves the workspace payer's plan and returns its dispatch concurrency.
 * Uses the same billing attribution the cells are billed under, so the window
 * follows whoever pays for the run.
 */
export async function resolveTableDispatchConcurrency(input: {
  workspaceId: string
  actorUserId?: string | null
}): Promise<number> {
  if (!isBillingEnabled) return getTableDispatchConcurrencyLimits().paid
  const { resolveBillingAttribution, resolveSystemBillingAttribution } = await import(
    '@/lib/billing/core/billing-attribution'
  )
  const attribution = input.actorUserId
    ? await resolveBillingAttribution({
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
      })
    : await resolveSystemBillingAttribution(input.workspaceId)
  return getTableDispatchConcurrency(attribution.payerSubscription?.plan)
}
