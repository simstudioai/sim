import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, inArray } from 'drizzle-orm'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { isTeam } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('OrganizationSeats')

export interface ReconcileOrganizationSeatsResult {
  changed: boolean
  previousSeats?: number
  seats?: number
  reason?: string
  outboxEventId?: string
}

interface ReconcileOrganizationSeatsParams {
  organizationId: string
  reason: string
  /**
   * Real `user.id` of the actor whose action triggered this reconcile, used to
   * attribute the seat-change audit log and analytics event. Omit for system
   * reconciles (e.g. the seat-drift sweep) that have no acting user; the audit
   * is then skipped and analytics fall back to the organization id.
   */
  actorId?: string
}

/**
 * Reconcile a Team organization's seat count to its current member count and
 * enqueue an outbox event to push the change to Stripe. This is the single
 * seat-accounting path for both joins and removals: paid seats always equal
 * the number of organization members.
 *
 * The DB write and the outbox enqueue commit atomically; the actual Stripe
 * charge/credit (proration via `always_invoice`) happens asynchronously in the
 * seat-sync handler. A failed charge surfaces through Stripe dunning and blocks
 * the org via the existing billing-blocked system rather than under this lock.
 * Concurrent joins/removals serialize on the subscription row's `FOR UPDATE`
 * lock and each reconciles to the live member count, so the final seat count is
 * always correct regardless of interleaving.
 */
export async function reconcileOrganizationSeats({
  organizationId,
  reason,
  actorId,
}: ReconcileOrganizationSeatsParams): Promise<ReconcileOrganizationSeatsResult> {
  if (!isBillingEnabled) {
    return { changed: false, reason: 'Billing is not enabled' }
  }

  type ReconcileOutcome =
    | { kind: 'skip'; reason: string }
    | { kind: 'noop'; seats: number }
    | {
        kind: 'changed'
        previousSeats: number
        seats: number
        outboxEventId: string
        sync: { id: string; plan: string; status: string | null }
      }

  const outcome = await db.transaction<ReconcileOutcome>(async (tx) => {
    const [orgSubscription] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .for('update')
      .limit(1)

    if (!orgSubscription) {
      return { kind: 'skip', reason: 'No active subscription found' }
    }
    if (!isTeam(orgSubscription.plan)) {
      return { kind: 'skip', reason: 'Seat changes are only available for Team plans' }
    }
    if (!orgSubscription.stripeSubscriptionId) {
      return { kind: 'skip', reason: 'No Stripe subscription found for this organization' }
    }

    const [memberCountRow] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    const targetSeats = Math.max(1, memberCountRow?.value ?? 1)
    const currentSeats = orgSubscription.seats ?? 1

    if (targetSeats === currentSeats) {
      return { kind: 'noop', seats: currentSeats }
    }

    await tx
      .update(subscription)
      .set({ seats: targetSeats })
      .where(eq(subscription.id, orgSubscription.id))

    const outboxEventId = await enqueueOutboxEvent(
      tx,
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      {
        subscriptionId: orgSubscription.id,
        reason,
      }
    )

    return {
      kind: 'changed',
      previousSeats: currentSeats,
      seats: targetSeats,
      outboxEventId,
      sync: {
        id: orgSubscription.id,
        plan: orgSubscription.plan,
        status: orgSubscription.status,
      },
    }
  })

  if (outcome.kind === 'skip') {
    return { changed: false, reason: outcome.reason }
  }
  if (outcome.kind === 'noop') {
    return { changed: false, previousSeats: outcome.seats, seats: outcome.seats }
  }

  try {
    await syncSubscriptionUsageLimits({
      id: outcome.sync.id,
      plan: outcome.sync.plan,
      referenceId: organizationId,
      status: outcome.sync.status,
      seats: outcome.seats,
    })
  } catch (error) {
    // Seats already committed in the transaction above; a failure here must not
    // suppress the audit/analytics events below for a change that already happened.
    logger.error('Failed to sync usage limits after seat reconciliation', {
      organizationId,
      previousSeats: outcome.previousSeats,
      seats: outcome.seats,
      error,
    })
  }

  logger.info('Reconciled organization seats to member count', {
    organizationId,
    previousSeats: outcome.previousSeats,
    seats: outcome.seats,
    reason,
    outboxEventId: outcome.outboxEventId,
  })

  const increased = outcome.seats > outcome.previousSeats
  if (actorId) {
    recordAudit({
      workspaceId: null,
      actorId,
      action: increased ? AuditAction.ORG_SEAT_PROVISIONED : AuditAction.ORG_SEAT_DEPROVISIONED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      description: `${increased ? 'Provisioned' : 'Deprovisioned'} organization seats: ${outcome.previousSeats} → ${outcome.seats}`,
      metadata: { previousSeats: outcome.previousSeats, seats: outcome.seats, reason },
    })
  }
  captureServerEvent(
    actorId ?? organizationId,
    increased ? 'seats_provisioned' : 'seats_deprovisioned',
    {
      organization_id: organizationId,
      previous_seats: outcome.previousSeats,
      seats: outcome.seats,
      reason,
    },
    { groups: { organization: organizationId } }
  )

  return {
    changed: true,
    previousSeats: outcome.previousSeats,
    seats: outcome.seats,
    outboxEventId: outcome.outboxEventId,
  }
}
