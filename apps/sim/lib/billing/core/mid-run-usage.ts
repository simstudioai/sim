import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { checkUsageStatus } from '@/lib/billing/calculations/usage-monitor'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import {
  type AccountBillingDecision,
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  refreshAttributionPeriod,
} from '@/lib/billing/core/billing-attribution'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { resolveSubscriptionUsagePeriod } from '@/lib/billing/core/reporting-period'
import { checkExecutionUsageLimits } from '@/lib/billing/core/usage-gate-cache'

const logger = createLogger('MidRunUsage')

/**
 * A run's standing while it is under way, read through the execution usage gate:
 * - `exceeded`: the payer (or the actor's member cap) spent its limit; the run pauses with the
 *   upgrade card.
 * - `blocked`: the account is blocked (payment failed, dispute); the run is refused as a blocked
 *   account, never with the upgrade card.
 * - `unknown`: usage, or the payer's current period, could not be read. Admission fails closed
 *   on an unreadable ledger, but a run already under way continues: a database blip must not
 *   end a paying user's long run, and the next step or re-check reads again.
 */
export type MidRunUsageVerdict =
  | { status: 'within' }
  | { status: 'exceeded'; scope?: AttributedUsageLimitsResult['scope'] }
  | { status: 'blocked'; message?: string }
  | { status: 'unknown' }

/**
 * How long a payer's current period stays cached for mid-run checks. Every model step settles a
 * cost callback that reads it; a subscription period change (rollover, anchor reset) reaches the
 * check within this long.
 */
const CURRENT_PERIOD_TTL_MS = 60 * 1000

const currentPeriodCache = new LRUCache<string, BillingAttributionSnapshot>({
  max: 10_000,
  ttl: CURRENT_PERIOD_TTL_MS,
})

function currentPeriodKey(attribution: BillingAttributionSnapshot): string {
  return [
    attribution.actorUserId,
    attribution.workspaceId ?? '',
    attribution.organizationId ?? '',
    attribution.billedAccountUserId,
  ].join(':')
}

/** The admitted payer's attribution for its current subscription period. */
async function currentAttribution(
  attribution: BillingAttributionSnapshot,
  fresh: boolean
): Promise<BillingAttributionSnapshot> {
  const key = currentPeriodKey(attribution)
  const cached = fresh ? undefined : currentPeriodCache.get(key)
  // A cached period that has since ended is stale: the payer may already be in the next one.
  if (cached && !periodHasEnded(cached)) return cached
  const current = await refreshAttributionPeriod(attribution)
  currentPeriodCache.set(key, current)
  return current
}

function periodHasEnded(attribution: BillingAttributionSnapshot): boolean {
  return Date.now() >= new Date(attribution.billingPeriod.end).getTime()
}

async function readGateVerdict(
  attribution: BillingAttributionSnapshot
): Promise<MidRunUsageVerdict> {
  let usage: AttributedUsageLimitsResult
  try {
    usage = await checkExecutionUsageLimits(attribution)
  } catch (error) {
    logger.warn('Mid-run usage read failed; continuing the run', {
      error: getErrorMessage(error),
    })
    return { status: 'unknown' }
  }
  if (!usage.isExceeded) return { status: 'within' }
  if (usage.reason === 'billing_blocked') {
    return { status: 'blocked', ...(usage.message ? { message: usage.message } : {}) }
  }
  if (usage.reason === 'usage_unavailable') {
    logger.warn('Mid-run usage could not be read; continuing the run')
    return { status: 'unknown' }
  }
  return { status: 'exceeded', ...(usage.scope ? { scope: usage.scope } : {}) }
}

/**
 * Judges a run against its admitted payer's CURRENT subscription period, never the period it was
 * admitted in: charges land in whatever period the subscription is in now (a rollover or an
 * early anchor reset included), so that is the allowance they count against. A read that
 * straddles the end of that period is judged again against the next one. If the current period
 * cannot be read the verdict is unknown, and the run continues.
 */
export async function readMidRunUsageVerdict(
  attribution: BillingAttributionSnapshot
): Promise<MidRunUsageVerdict> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let judged: BillingAttributionSnapshot
    try {
      judged = await currentAttribution(attribution, attempt > 0)
      if (periodHasEnded(judged)) return { status: 'unknown' }
    } catch (error) {
      logger.warn('Current billing period could not be read; continuing the run', {
        error: getErrorMessage(error),
      })
      return { status: 'unknown' }
    }
    const verdict = await readGateVerdict(judged)
    if (!periodHasEnded(judged)) return verdict
  }
  return { status: 'unknown' }
}

/**
 * The same verdict for a direct-v1 run billed to an account decision rather than an attributed
 * payer. The payer is the one saved in the decision at admission, never re-selected from the
 * actor's current memberships, judged against that payer's current subscription period.
 */
export async function readMidRunAccountUsageVerdict(
  decision: AccountBillingDecision
): Promise<MidRunUsageVerdict> {
  try {
    const payer = decision.billingEntity
    const subscription =
      payer.type === 'organization'
        ? await getOrganizationSubscription(payer.id, { onError: 'throw' })
        : await getHighestPriorityPersonalSubscription(payer.id, { onError: 'throw' })
    const billingPeriod = resolveSubscriptionUsagePeriod(subscription) ?? {
      ...defaultBillingPeriod(),
      source: 'default' as const,
    }
    // An organization payer without a subscription stays organization-scoped on the free plan,
    // as `toUsageLimitSubscription` does for attributed runs, never the actor's personal ledger.
    const usageSubscription =
      subscription ??
      (payer.type === 'organization'
        ? {
            referenceId: payer.id,
            plan: 'free',
            status: null,
            seats: null,
            periodStart: billingPeriod.start,
            periodEnd: billingPeriod.end,
          }
        : null)
    const usage = await checkUsageStatus(decision.userId, usageSubscription, {
      billingEntity: payer,
      billingPeriod,
    })
    if (usage.unavailable) return { status: 'unknown' }
    return usage.isExceeded ? { status: 'exceeded', scope: 'payer' } : { status: 'within' }
  } catch (error) {
    logger.warn('Mid-run account usage read failed; continuing the run', {
      error: getErrorMessage(error),
    })
    return { status: 'unknown' }
  }
}

/** Drops every cached current period. Test seam; never called in production code. */
export function resetMidRunPeriodCache(): void {
  currentPeriodCache.clear()
}
