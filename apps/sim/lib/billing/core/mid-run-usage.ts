import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { checkUsageStatus } from '@/lib/billing/calculations/usage-monitor'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import {
  type AccountBillingDecision,
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  checkAccountBillingBlocks,
  refreshAttributionPeriod,
} from '@/lib/billing/core/billing-attribution'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { resolveSubscriptionUsagePeriod } from '@/lib/billing/core/reporting-period'
import {
  checkExecutionUsageLimits,
  USAGE_GATE_SETTLE_TIMEOUT_MS,
  USAGE_GATE_TTL_MS,
} from '@/lib/billing/core/usage-gate-cache'
import type { UsageUpgradePayer } from '@/lib/billing/usage-upgrade'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

const logger = createLogger('MidRunUsage')

/**
 * A run's standing while it is under way, read through the execution usage gate:
 * - `exceeded`: the payer (or the actor's member cap) spent its limit; the run pauses with the
 *   upgrade card. A direct-v1 verdict carries the payer it read, so the card names that payer's
 *   plan rather than the actor's.
 * - `blocked`: the account is blocked (payment failed, dispute); the run is refused as a blocked
 *   account, never with the upgrade card.
 * - `unknown`: usage, or the payer's current period, could not be read. Admission fails closed
 *   on an unreadable ledger, but a run already under way continues: a database blip must not
 *   end a paying user's long run, and the next step or re-check reads again.
 */
export type MidRunUsageVerdict =
  | { status: 'within' }
  | {
      status: 'exceeded'
      scope?: AttributedUsageLimitsResult['scope']
      payer?: UsageUpgradePayer
    }
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
  attribution: BillingAttributionSnapshot
): Promise<BillingAttributionSnapshot> {
  const key = currentPeriodKey(attribution)
  const cached = currentPeriodCache.get(key)
  // A cached period that has since ended is stale: the payer may already be in the next one.
  if (cached && !periodHasEnded(cached)) return cached
  const current = await refreshAttributionPeriod(attribution)
  currentPeriodCache.set(key, current)
  return current
}

/** Mirrors the cost callback's rollover gate: only a Stripe period rolls forward. */
function rollsIntoCurrentPeriod(period: { source?: string }): boolean {
  return period.source === 'stripe'
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
 * Judges a run against the period its charges land in. A Stripe-period payer's charges roll into
 * whatever period the subscription is in now (a rollover or an early anchor reset included), so
 * such a run is judged against the payer's CURRENT period. A current period that cannot be read,
 * or that ends before its verdict is read, makes the verdict unknown, so the run continues and the
 * next callback judges the next period. Any other payer's charges stay in the admitted
 * period (a reporting window, or the open default one), so that period is judged, even after it
 * ends.
 */
export async function readMidRunUsageVerdict(
  attribution: BillingAttributionSnapshot
): Promise<MidRunUsageVerdict> {
  if (!isHosted || !isBillingEnabled) return { status: 'within' }
  if (!rollsIntoCurrentPeriod(attribution.billingPeriod)) return readGateVerdict(attribution)
  let judged: BillingAttributionSnapshot
  try {
    judged = await currentAttribution(attribution)
  } catch (error) {
    logger.warn('Current billing period could not be read; continuing the run', {
      error: getErrorMessage(error),
    })
    return { status: 'unknown' }
  }
  if (periodHasEnded(judged)) return { status: 'unknown' }
  const verdict = await readGateVerdict(judged)
  // A period that ended during the read is judged at the next callback, which reloads it.
  return periodHasEnded(judged) ? { status: 'unknown' } : verdict
}

/**
 * Admitted direct-v1 verdicts, served for the execution gate's TTL like
 * {@link checkExecutionUsageLimits} serves attributed ones: the worker re-validates a run on
 * every resume leg, and each uncached read sums the payer's ledger for the period. Only a
 * `within` verdict is stored, so a refusal or an unreadable ledger is always read again.
 */
const accountVerdictCache = new LRUCache<string, MidRunUsageVerdict>({
  max: 10_000,
  ttl: USAGE_GATE_TTL_MS,
})

/**
 * The same verdict for a direct-v1 run billed to an account decision rather than an attributed
 * payer, in the gate's order: a blocked actor or payer first, then the payer's spend. The payer
 * is the one saved in the decision at admission, never re-selected from the actor's current
 * memberships, and the period judged is the one its charges land in, as for attributed runs.
 */
export async function readMidRunAccountUsageVerdict(
  decision: AccountBillingDecision
): Promise<MidRunUsageVerdict> {
  if (!isHosted || !isBillingEnabled) return { status: 'within' }
  try {
    const payer = decision.billingEntity
    const subscription =
      payer.type === 'organization'
        ? await getOrganizationSubscription(payer.id, { onError: 'throw' })
        : await getHighestPriorityPersonalSubscription(payer.id, { onError: 'throw' })
    const billingPeriod = rollsIntoCurrentPeriod(decision.billingPeriod)
      ? (resolveSubscriptionUsagePeriod(subscription) ?? {
          ...defaultBillingPeriod(),
          source: 'default' as const,
        })
      : {
          start: new Date(decision.billingPeriod.start),
          end: new Date(decision.billingPeriod.end),
          source: decision.billingPeriod.source ?? ('default' as const),
        }
    const key = [
      payer.type,
      payer.id,
      billingPeriod.start.toISOString(),
      billingPeriod.end.toISOString(),
      billingPeriod.source,
      decision.userId,
      subscription?.id ?? '',
      subscription?.plan ?? '',
      subscription?.status ?? '',
      subscription?.seats ?? '',
    ].join(':')
    const cached = accountVerdictCache.get(key)
    if (cached) return cached
    const block = await checkAccountBillingBlocks(decision)
    if (block.blocked) {
      return { status: 'blocked', ...(block.message ? { message: block.message } : {}) }
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
    const usage = await coalesceLocally(
      `mid-run-account-usage:${key}`,
      () =>
        checkUsageStatus(decision.userId, usageSubscription, {
          billingEntity: payer,
          billingPeriod,
        }),
      USAGE_GATE_SETTLE_TIMEOUT_MS
    )
    if (usage.unavailable) return { status: 'unknown' }
    if (usage.isExceeded) {
      return {
        status: 'exceeded',
        scope: 'payer',
        payer: { billingEntity: payer, payerSubscription: subscription },
      }
    }
    const within: MidRunUsageVerdict = { status: 'within' }
    accountVerdictCache.set(key, within)
    return within
  } catch (error) {
    logger.warn('Mid-run account usage read failed; continuing the run', {
      error: getErrorMessage(error),
    })
    return { status: 'unknown' }
  }
}

/** Drops every cached current period and account verdict. Test seam; never called in production code. */
export function resetMidRunUsageCaches(): void {
  currentPeriodCache.clear()
  accountVerdictCache.clear()
}
