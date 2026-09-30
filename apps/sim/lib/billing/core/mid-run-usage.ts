import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  AttributedUsageLimitsResult,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { checkExecutionUsageLimits } from '@/lib/billing/core/usage-gate-cache'

const logger = createLogger('MidRunUsage')

/**
 * A run's standing while it is under way, read through the execution usage gate:
 * - `exceeded`: the payer (or the actor's member cap) spent its limit; the run pauses with the
 *   upgrade card.
 * - `blocked`: the account is blocked (payment failed, dispute); the run is refused as a blocked
 *   account, never with the upgrade card.
 * - `unknown`: the gate could not read usage, or the run's admitted period has ended. Admission
 *   fails closed on an unreadable ledger, but a run already under way continues: a database
 *   blip must not end a paying user's long run, and the next step or re-check reads again.
 */
export type MidRunUsageVerdict =
  | { status: 'within' }
  | { status: 'exceeded'; scope?: AttributedUsageLimitsResult['scope'] }
  | { status: 'blocked'; message?: string }
  | { status: 'unknown' }

export async function readMidRunUsageVerdict(
  attribution: BillingAttributionSnapshot
): Promise<MidRunUsageVerdict> {
  // The gate judges the admitted snapshot's period. Once that period has ended it would keep
  // counting the old period against the old allowance, so a run just past a reset is not judged
  // until its next admission reads the new one.
  if (Date.now() >= new Date(attribution.billingPeriod.end).getTime()) {
    return { status: 'unknown' }
  }
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
