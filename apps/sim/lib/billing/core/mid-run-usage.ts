import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { checkUsageStatus } from '@/lib/billing/calculations/usage-monitor'
import {
  type AccountBillingDecision,
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  refreshAttributionPeriod,
} from '@/lib/billing/core/billing-attribution'
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
 * The gate judges the snapshot's period, so a run that outlived its admitted period is judged
 * against the same payer's current period instead, and a read that straddled the period's end
 * is judged again against the new one. If the current period cannot be read the verdict is
 * unknown, and the run continues.
 */
export async function readMidRunUsageVerdict(
  attribution: BillingAttributionSnapshot
): Promise<MidRunUsageVerdict> {
  let judged = attribution
  for (let attempt = 0; attempt < 2; attempt++) {
    if (periodHasEnded(judged)) {
      try {
        judged = await refreshAttributionPeriod(judged)
        if (periodHasEnded(judged)) return { status: 'unknown' }
      } catch (error) {
        logger.warn('Current billing period could not be read; continuing the run', {
          error: getErrorMessage(error),
        })
        return { status: 'unknown' }
      }
    }
    const verdict = await readGateVerdict(judged)
    if (!periodHasEnded(judged)) return verdict
  }
  return { status: 'unknown' }
}

/**
 * The same verdict for a direct-v1 run billed to an account decision rather than an attributed
 * payer, read through the account usage check. A decision whose period has ended is judged
 * against the account's current period.
 */
export async function readMidRunAccountUsageVerdict(
  decision: AccountBillingDecision
): Promise<MidRunUsageVerdict> {
  try {
    const ended = Date.now() >= new Date(decision.billingPeriod.end).getTime()
    const usage = await checkUsageStatus(
      decision.userId,
      undefined,
      ended
        ? undefined
        : {
            billingEntity: decision.billingEntity,
            billingPeriod: {
              start: new Date(decision.billingPeriod.start),
              end: new Date(decision.billingPeriod.end),
              ...(decision.billingPeriod.source ? { source: decision.billingPeriod.source } : {}),
            },
          }
    )
    if (usage.unavailable) return { status: 'unknown' }
    return usage.isExceeded ? { status: 'exceeded', scope: 'payer' } : { status: 'within' }
  } catch (error) {
    logger.warn('Mid-run account usage read failed; continuing the run', {
      error: getErrorMessage(error),
    })
    return { status: 'unknown' }
  }
}
