import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq, inArray } from 'drizzle-orm'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isTeam } from '@/lib/billing/plan-helpers'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('SeatDriftSweep')

/** Max orgs reconciled per sweep run so a mass-drift event can't run away. */
const MAX_RECONCILES_PER_RUN = 100

export interface SeatDriftSweepResult {
  /** How many Team orgs were found with a seat/member-count mismatch. */
  drifted: number
  /** How many of those were reconciled (seat count changed) this run. */
  reconciled: number
}

/**
 * Periodic backstop that re-aligns Team organizations whose stored seat count
 * has drifted from their actual member count — e.g. when a post-join or
 * post-removal `reconcileOrganizationSeats` transaction failed before
 * committing. Each drifted org is reconciled, which re-enqueues the Stripe
 * seat-sync.
 *
 * This only catches drift where the DB seat count is wrong. The opposite case —
 * the DB committed but the Stripe sync dead-lettered — is surfaced via the
 * dead-letter report, since the seat counts already match here.
 */
export async function reconcileTeamSeatDrift(): Promise<SeatDriftSweepResult> {
  if (!isBillingEnabled) {
    return { drifted: 0, reconciled: 0 }
  }

  const rows = await db
    .select({
      organizationId: subscription.referenceId,
      plan: subscription.plan,
      seats: subscription.seats,
      memberCount: count(member.id),
    })
    .from(subscription)
    .innerJoin(member, eq(member.organizationId, subscription.referenceId))
    .where(inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES))
    .groupBy(subscription.referenceId, subscription.plan, subscription.seats)

  const drifted = rows.filter((row) => isTeam(row.plan) && (row.seats ?? 1) !== row.memberCount)
  const batch = drifted.slice(0, MAX_RECONCILES_PER_RUN)

  let reconciled = 0
  for (const row of batch) {
    try {
      const result = await reconcileOrganizationSeats({
        organizationId: row.organizationId,
        reason: 'seat-drift-sweep',
      })
      if (result.changed) reconciled++
    } catch (error) {
      logger.error('Failed to reconcile seat drift for organization', {
        organizationId: row.organizationId,
        error,
      })
    }
  }

  if (drifted.length > batch.length) {
    logger.warn('Seat drift sweep hit its per-run cap; remaining orgs reconcile next run', {
      drifted: drifted.length,
      cap: MAX_RECONCILES_PER_RUN,
    })
  } else if (drifted.length > 0) {
    logger.info('Seat drift sweep reconciled organizations', {
      drifted: drifted.length,
      reconciled,
    })
  }

  return { drifted: drifted.length, reconciled }
}
