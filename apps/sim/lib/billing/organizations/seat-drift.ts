import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

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
 *
 * Candidates are sampled in random order so that, when more than
 * `MAX_RECONCILES_PER_RUN` orgs drift, a subset that keeps failing can't starve
 * the rest — each run reconciles a different random slice until all converge.
 * Subscriptions without a Stripe id are excluded since their drift is not
 * resolvable here (reconcile can't push to Stripe).
 */
export async function reconcileTeamSeatDrift(): Promise<SeatDriftSweepResult> {
  if (!isBillingEnabled) {
    return { drifted: 0, reconciled: 0 }
  }

  /**
   * The filter runs entirely in SQL: only Team plans (`team` or `team_*`), with
   * a usable status and a Stripe id, whose stored `seats` differs from their
   * live member count (`HAVING`). Non-Team orgs are never materialized.
   */
  const driftedRows = await db
    .select({ organizationId: subscription.referenceId })
    .from(subscription)
    .innerJoin(member, eq(member.organizationId, subscription.referenceId))
    .where(
      and(
        inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES),
        isNotNull(subscription.stripeSubscriptionId),
        or(eq(subscription.plan, 'team'), like(subscription.plan, 'team\\_%'))
      )
    )
    .groupBy(subscription.referenceId, subscription.plan, subscription.seats)
    .having(sql`coalesce(${subscription.seats}, 1) <> count(${member.id})`)
    .orderBy(sql`random()`)

  const batch = driftedRows.slice(0, MAX_RECONCILES_PER_RUN)

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

  if (driftedRows.length > batch.length) {
    logger.warn('Seat drift sweep hit its per-run cap; remaining orgs reconcile next run', {
      drifted: driftedRows.length,
      cap: MAX_RECONCILES_PER_RUN,
    })
  } else if (driftedRows.length > 0) {
    logger.info('Seat drift sweep reconciled organizations', {
      drifted: driftedRows.length,
      reconciled,
    })
  }

  return { drifted: driftedRows.length, reconciled }
}
