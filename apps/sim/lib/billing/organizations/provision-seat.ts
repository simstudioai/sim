import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { subscription as subscriptionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { CREDIT_TIERS } from '@/lib/billing/constants'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { ensureOrganizationForTeamSubscription } from '@/lib/billing/organization'
import {
  buildPlanName,
  getPlanTierCredits,
  isEnterprise,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { getPlanByName } from '@/lib/billing/plans'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('ProvisionSeat')

interface RecordPlanConversionParams {
  organizationId: string
  actorId: string
  fromPlan: string
  toPlan: string
}

/**
 * Record telemetry for a Pro→Team plan conversion triggered by invite
 * acceptance. Fire-and-forget — `recordAudit` and `captureServerEvent` never
 * throw, so this can never break the conversion flow. The billing interval is
 * preserved across the conversion, so it is reported as `unchanged`.
 */
function recordPlanConversion({
  organizationId,
  actorId,
  fromPlan,
  toPlan,
}: RecordPlanConversionParams): void {
  recordAudit({
    workspaceId: null,
    actorId,
    action: AuditAction.ORG_PLAN_CONVERTED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: `Converted ${fromPlan} to ${toPlan}`,
    metadata: {
      fromPlan,
      toPlan,
      trigger: 'invite-acceptance',
    },
  })
  captureServerEvent(actorId, 'subscription_changed', {
    from_plan: fromPlan,
    to_plan: toPlan,
    interval: 'unchanged',
  })
}

export type EnsureTeamOrganizationFailureCode = 'upgrade-required' | 'server-error'

export type EnsureTeamOrganizationResult =
  | { success: true; organizationId: string; fixedSeats: boolean }
  | { success: false; failureCode: EnsureTeamOrganizationFailureCode }

interface EnsureTeamOrganizationParams {
  billingOwnerUserId: string
  workspaceOrganizationId: string | null
}

/**
 * Ensure the organization an invitee is about to enter exists and is on a Team
 * plan, WITHOUT calling Stripe. Returns the organization to add the member to
 * and whether seats are fixed (Enterprise).
 *
 * Seat purchasing is intentionally decoupled from this synchronous path: after
 * the member is added, the caller reconciles the seat count and the actual
 * Stripe charge happens asynchronously via the seat-sync outbox. A failed
 * charge then blocks the org through the existing billing-blocked system rather
 * than blocking acceptance synchronously. This keeps the accept path pure-DB,
 * with no external call held under a lock.
 *
 * - Organization (Team): no-op; the org already exists on a Team plan.
 * - Organization (Enterprise): `fixedSeats: true` — the caller keeps the
 *   fixed-seat validation and seats do not auto-grow.
 * - Organization (org-scoped Pro): move the plan to the equivalent Team tier.
 * - Personal/grandfathered (Pro, or legacy personal Team): create the org,
 *   attach workspaces, and move to a Team plan.
 * - Free / no usable subscription / no eligible Team tier: `upgrade-required`.
 */
export async function ensureTeamOrganizationForAcceptance(
  params: EnsureTeamOrganizationParams
): Promise<EnsureTeamOrganizationResult> {
  const { billingOwnerUserId, workspaceOrganizationId } = params

  try {
    if (workspaceOrganizationId) {
      return await ensureOrganizationOnTeamPlan(workspaceOrganizationId, billingOwnerUserId)
    }
    return await convertPersonalSubscriptionToTeam(billingOwnerUserId)
  } catch (error) {
    logger.error('Failed to ensure team organization for acceptance', {
      billingOwnerUserId,
      workspaceOrganizationId,
      error,
    })
    return { success: false, failureCode: 'server-error' }
  }
}

async function ensureOrganizationOnTeamPlan(
  organizationId: string,
  actorId: string
): Promise<EnsureTeamOrganizationResult> {
  const orgSub = await getOrganizationSubscription(organizationId)
  if (!orgSub || !hasUsableSubscriptionStatus(orgSub.status)) {
    return { success: false, failureCode: 'upgrade-required' }
  }

  if (isEnterprise(orgSub.plan)) {
    return { success: true, organizationId, fixedSeats: true }
  }

  if (!isTeam(orgSub.plan)) {
    const targetPlan = mapToTeamPlanName(orgSub.plan)
    if (!targetPlan) {
      return { success: false, failureCode: 'upgrade-required' }
    }
    await activateTeamSubscription(orgSub, targetPlan, { planChanged: true })
    recordPlanConversion({
      organizationId,
      actorId,
      fromPlan: orgSub.plan,
      toPlan: targetPlan,
    })
  }

  return { success: true, organizationId, fixedSeats: false }
}

async function convertPersonalSubscriptionToTeam(
  userId: string
): Promise<EnsureTeamOrganizationResult> {
  const personalSub = await getHighestPriorityPersonalSubscription(userId)
  if (!personalSub || !hasUsableSubscriptionStatus(personalSub.status)) {
    return { success: false, failureCode: 'upgrade-required' }
  }

  const alreadyTeam = isTeam(personalSub.plan)
  if (!alreadyTeam && !isPro(personalSub.plan)) {
    return { success: false, failureCode: 'upgrade-required' }
  }

  const targetPlan = mapToTeamPlanName(personalSub.plan)
  if (!targetPlan) {
    return { success: false, failureCode: 'upgrade-required' }
  }

  await activateTeamSubscription(personalSub, targetPlan, { planChanged: !alreadyTeam })

  const updated = await ensureOrganizationForTeamSubscription({
    id: personalSub.id,
    plan: targetPlan,
    referenceId: userId,
    status: personalSub.status,
    seats: personalSub.seats ?? 1,
  })

  logger.info('Converted personal subscription to Team on invite acceptance', {
    userId,
    organizationId: updated.referenceId,
    plan: targetPlan,
    upgradedFromPro: !alreadyTeam,
  })

  if (!alreadyTeam) {
    recordPlanConversion({
      organizationId: updated.referenceId,
      actorId: userId,
      fromPlan: personalSub.plan,
      toPlan: targetPlan,
    })
  }

  return { success: true, organizationId: updated.referenceId, fixedSeats: false }
}

/**
 * Activate a subscription as a Team plan in one transaction and durably enqueue
 * the Stripe reconciliation. When the plan actually changes (Pro→Team), the
 * seat-sync event is enqueued so the handler migrates the Stripe price (and
 * quantity) at processing time — guaranteeing the price change lands even if
 * the post-join seat reconcile is skipped or fails. Any scheduled cancellation
 * is cleared (DB + Stripe) so a freshly-activated Team is not left scheduled to
 * cancel, including the legacy personal-scoped Team case where the plan is
 * unchanged.
 */
async function activateTeamSubscription(
  sub: { id: string; cancelAtPeriodEnd?: boolean | null; stripeSubscriptionId: string | null },
  targetPlan: string,
  { planChanged }: { planChanged: boolean }
): Promise<void> {
  const shouldClearCancellation =
    Boolean(sub.cancelAtPeriodEnd) && Boolean(sub.stripeSubscriptionId)

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptionTable)
      .set({ plan: targetPlan, cancelAtPeriodEnd: false })
      .where(eq(subscriptionTable.id, sub.id))

    if (planChanged) {
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS, {
        subscriptionId: sub.id,
        reason: 'pro-to-team-conversion',
      })
    }

    if (shouldClearCancellation) {
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
        stripeSubscriptionId: sub.stripeSubscriptionId as string,
        subscriptionId: sub.id,
        reason: 'pro-to-team-conversion',
      })
    }
  })
}

/**
 * Map a Pro (or legacy) plan to a Team tier, choosing the smallest Team tier
 * whose credit allowance is at least the current plan's so an upgrade never
 * silently drops credits. Returns `null` when no eligible Team tier exists
 * (e.g. a Max owner when the Team Max price is unconfigured) so the caller can
 * surface `upgrade-required` instead of downgrading.
 */
function mapToTeamPlanName(plan: string): string | null {
  if (isTeam(plan)) return plan

  const credits = getPlanTierCredits(plan)
  const eligibleTiers = [...CREDIT_TIERS]
    .filter((tier) => tier.credits >= credits)
    .sort((a, b) => a.credits - b.credits)

  for (const tier of eligibleTiers) {
    const candidate = buildPlanName('team', tier.credits)
    if (getPlanByName(candidate)) {
      return candidate
    }
  }
  return null
}
