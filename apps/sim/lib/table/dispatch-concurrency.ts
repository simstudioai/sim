import { getPlanTypeForLimits, type PlanCategory } from '@/lib/billing/plan-helpers'
import { env, envNumber } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

/**
 * Default per-plan table dispatch concurrency — how many rows one table run
 * executes in parallel (the dispatcher window size). Overridable via the
 * `TABLE_DISPATCH_CONCURRENCY_{FREE,PRO,TEAM,ENTERPRISE}` env vars.
 */
export const DEFAULT_TABLE_DISPATCH_CONCURRENCY = {
  free: 20,
  pro: 50,
  team: 50,
  enterprise: 50,
} as const satisfies Record<PlanCategory, number>

/**
 * Resolves per-plan dispatch concurrency, applying env overrides on top of
 * the defaults.
 */
export function getTableDispatchConcurrencyLimits(): Record<PlanCategory, number> {
  return {
    free: envNumber(env.TABLE_DISPATCH_CONCURRENCY_FREE, DEFAULT_TABLE_DISPATCH_CONCURRENCY.free, {
      min: 1,
      integer: true,
    }),
    pro: envNumber(env.TABLE_DISPATCH_CONCURRENCY_PRO, DEFAULT_TABLE_DISPATCH_CONCURRENCY.pro, {
      min: 1,
      integer: true,
    }),
    team: envNumber(env.TABLE_DISPATCH_CONCURRENCY_TEAM, DEFAULT_TABLE_DISPATCH_CONCURRENCY.team, {
      min: 1,
      integer: true,
    }),
    enterprise: envNumber(
      env.TABLE_DISPATCH_CONCURRENCY_ENTERPRISE,
      DEFAULT_TABLE_DISPATCH_CONCURRENCY.enterprise,
      { min: 1, integer: true }
    ),
  }
}

/**
 * Dispatch concurrency for one payer plan. Billing-disabled deployments get
 * the highest configured tier.
 */
export function getTableDispatchConcurrency(plan: string | null | undefined): number {
  if (!isBillingEnabled) return getMaxTableDispatchConcurrency()
  return getTableDispatchConcurrencyLimits()[getPlanTypeForLimits(plan)]
}

/**
 * Highest configured dispatch concurrency across plans. The
 * `workflow-group-cell` trigger.dev queue cap derives from this so the
 * server-side per-table ceiling never throttles below a plan's window.
 */
export function getMaxTableDispatchConcurrency(): number {
  return Math.max(...Object.values(getTableDispatchConcurrencyLimits()))
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
  if (!isBillingEnabled) return getMaxTableDispatchConcurrency()
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
