import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, outboxEvent, subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getEmailSubject, renderEnterpriseSubscriptionEmail } from '@/components/emails'
import { deriveEnterpriseCreditLimits } from '@/lib/billing/enterprise-credit-limits'
import {
  ENTERPRISE_PROVISION_EVENT_TYPE,
  type EnterpriseProvisionPayload,
  enterpriseOperationMatchesStripeSubscription,
  parseEnterpriseProvisionPayload,
} from '@/lib/billing/enterprise-outbox'
import {
  acquireOrganizationMutationLock,
  reapplyPaidOrgJoinBillingForExistingMemberTx,
} from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import {
  assertEnterpriseReconciliationLeaseHeld,
  type EnterpriseReconciliationLease,
  withEnterpriseReconciliationLease,
} from '@/lib/billing/webhooks/enterprise-reconciliation-lease'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import { patchOutboxEventPayload } from '@/lib/core/outbox/service'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import { captureServerEvent } from '@/lib/posthog/server'
import { parseEnterpriseSubscriptionMetadata } from '../types'

const logger = createLogger('BillingEnterprise')

export async function handleManualEnterpriseSubscription(event: Stripe.Event) {
  return stripeWebhookIdempotency.executeWithIdempotency(
    'manual-enterprise-subscription',
    event.id,
    () => processManualEnterpriseSubscription(event)
  )
}

async function processManualEnterpriseSubscription(event: Stripe.Event) {
  const eventSubscription = event.data.object as Stripe.Subscription
  const eventPlan = eventSubscription.metadata?.plan?.toLowerCase() ?? ''
  if (eventPlan !== 'enterprise') {
    logger.info('[subscription] Skipping non-enterprise subscription', {
      subscriptionId: eventSubscription.id,
      plan: eventPlan || 'unknown',
    })
    return
  }

  return withEnterpriseReconciliationLease(eventSubscription.id, (lease) =>
    reconcileManualEnterpriseSubscription(eventSubscription, lease)
  )
}

async function reconcileManualEnterpriseSubscription(
  eventSubscription: Stripe.Subscription,
  reconciliationLease: EnterpriseReconciliationLease
) {
  // Stripe does not promise webhook ordering. Read the current object before
  // taking DB locks so a delayed created/updated event cannot overwrite newer
  // status or metadata that Stripe has already accepted.
  const stripeSubscription = await requireStripeClient().subscriptions.retrieve(
    eventSubscription.id
  )

  const metaPlan = (stripeSubscription.metadata?.plan as string | undefined)?.toLowerCase() || ''

  if (metaPlan !== 'enterprise') {
    logger.info('[subscription] Enterprise metadata was removed before reconciliation', {
      subscriptionId: stripeSubscription.id,
      plan: metaPlan || 'unknown',
    })
    return
  }

  const stripeCustomerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id

  if (!stripeCustomerId) {
    logger.error('[subscription.created] Missing Stripe customer ID', {
      subscriptionId: stripeSubscription.id,
    })
    throw new Error('Missing Stripe customer ID on subscription')
  }

  const metadata = stripeSubscription.metadata || {}

  const referenceId =
    typeof metadata.referenceId === 'string' && metadata.referenceId.length > 0
      ? metadata.referenceId
      : null

  if (!referenceId) {
    logger.error('[subscription.created] Unable to resolve referenceId', {
      subscriptionId: stripeSubscription.id,
      stripeCustomerId,
    })
    throw new Error('Unable to resolve referenceId for subscription')
  }

  const enterpriseMetadata = parseEnterpriseSubscriptionMetadata(metadata)
  if (!enterpriseMetadata) {
    logger.error('[subscription.created] Invalid enterprise metadata shape', {
      subscriptionId: stripeSubscription.id,
      metadata,
    })
    throw new Error('Invalid enterprise metadata for subscription')
  }

  const { seats, monthlyPrice } = enterpriseMetadata

  // Get the first subscription item which contains the period information
  const referenceItem = stripeSubscription.items?.data?.[0]

  const subscriptionRow = {
    id: generateId(),
    plan: 'enterprise',
    referenceId,
    stripeCustomerId,
    stripeSubscriptionId: stripeSubscription.id,
    status: stripeSubscription.status || null,
    periodStart: referenceItem?.current_period_start
      ? new Date(referenceItem.current_period_start * 1000)
      : null,
    periodEnd: referenceItem?.current_period_end
      ? new Date(referenceItem.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? null,
    cancelAt: stripeSubscription.cancel_at ? new Date(stripeSubscription.cancel_at * 1000) : null,
    canceledAt: stripeSubscription.canceled_at
      ? new Date(stripeSubscription.canceled_at * 1000)
      : null,
    endedAt: stripeSubscription.ended_at ? new Date(stripeSubscription.ended_at * 1000) : null,
    seats: 1, // Enterprise uses metadata.seats for actual seat count, column is always 1
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null,
    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    billingInterval: referenceItem?.price?.recurring?.interval ?? null,
    metadata: metadata as Record<string, unknown>,
  }

  const coreResult = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, referenceId)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-subscription:${stripeSubscription.id}`}, 0))`
    )
    // The authoritative Stripe read happened under a durable subscription
    // lease. Fence the write before touching billing state so a crashed holder
    // whose lease was reclaimed cannot apply an older snapshot.
    await assertEnterpriseReconciliationLeaseHeld(tx, reconciliationLease)
    const [organizationRow] = await tx
      .select({ creditBalance: organization.creditBalance })
      .from(organization)
      .where(eq(organization.id, referenceId))
      .for('update')
      .limit(1)
    if (!organizationRow) throw new Error('Enterprise organization not found')

    const operationId = metadata.enterpriseOperationId
    let correlatedOperation: EnterpriseProvisionPayload | null = null
    let operationNewlyApplied = false
    if (typeof operationId === 'string' && operationId.length > 0) {
      const [operationRow] = await tx
        .select({ eventType: outboxEvent.eventType, payload: outboxEvent.payload })
        .from(outboxEvent)
        .where(eq(outboxEvent.id, operationId))
        .for('update')
        .limit(1)
      const operationPayload = operationRow
        ? parseEnterpriseProvisionPayload(operationRow.payload)
        : null
      const [operationOwner] = operationPayload
        ? await tx
            .select({ stripeCustomerId: user.stripeCustomerId })
            .from(user)
            .where(eq(user.id, operationPayload.request.ownerUserId))
            .limit(1)
        : []
      const validCorrelation = Boolean(
        operationRow?.eventType === ENTERPRISE_PROVISION_EVENT_TYPE &&
          operationPayload &&
          operationPayload.request.organizationId === referenceId &&
          operationOwner?.stripeCustomerId === stripeCustomerId &&
          (!operationPayload.stripeProgress.subscriptionId ||
            operationPayload.stripeProgress.subscriptionId === stripeSubscription.id) &&
          (!operationPayload.applicationResult ||
            operationPayload.applicationResult.subscriptionId === stripeSubscription.id) &&
          enterpriseOperationMatchesStripeSubscription(
            operationPayload,
            stripeSubscription,
            referenceId
          )
      )
      if (validCorrelation && operationPayload) {
        correlatedOperation = operationPayload
        operationNewlyApplied = !operationPayload.applicationResult
      } else {
        logger.warn('[subscription] Ignoring invalid Enterprise operation correlation', {
          operationId,
          subscriptionId: stripeSubscription.id,
          referenceId,
        })
      }
    }

    const [currentMemberCount] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, referenceId))
    if (seats < (currentMemberCount?.value ?? 0)) {
      throw new Error(
        `Enterprise seat capacity ${seats} is below current internal membership ${currentMemberCount?.value ?? 0}`
      )
    }

    const entitledSubscriptions = await tx
      .select({ id: subscription.id, stripeSubscriptionId: subscription.stripeSubscriptionId })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, referenceId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
    const conflictingEntitlement = entitledSubscriptions.find(
      (row) => row.stripeSubscriptionId !== stripeSubscription.id
    )
    if (conflictingEntitlement) {
      throw new Error(
        `Organization ${referenceId} already has a different entitled subscription (${conflictingEntitlement.id})`
      )
    }

    const [existing] = await tx
      .select({ id: subscription.id, referenceId: subscription.referenceId })
      .from(subscription)
      .where(eq(subscription.stripeSubscriptionId, stripeSubscription.id))
      .limit(1)

    if (existing && existing.referenceId !== referenceId) {
      throw new Error(
        `Stripe subscription ${stripeSubscription.id} is already bound to organization ${existing.referenceId}`
      )
    }

    if (existing) {
      await tx
        .update(subscription)
        .set({
          plan: subscriptionRow.plan,
          referenceId: subscriptionRow.referenceId,
          stripeCustomerId: subscriptionRow.stripeCustomerId,
          status: subscriptionRow.status,
          periodStart: subscriptionRow.periodStart,
          periodEnd: subscriptionRow.periodEnd,
          cancelAtPeriodEnd: subscriptionRow.cancelAtPeriodEnd,
          cancelAt: subscriptionRow.cancelAt,
          canceledAt: subscriptionRow.canceledAt,
          endedAt: subscriptionRow.endedAt,
          seats: 1,
          trialStart: subscriptionRow.trialStart,
          trialEnd: subscriptionRow.trialEnd,
          billingInterval: subscriptionRow.billingInterval,
          metadata: subscriptionRow.metadata,
        })
        .where(eq(subscription.id, existing.id))
    } else {
      await tx.insert(subscription).values(subscriptionRow)
    }

    const creditLimits = deriveEnterpriseCreditLimits({
      metadata,
      monthlyPriceUsd: monthlyPrice,
      prepaidBalanceDollars: organizationRow.creditBalance,
    })
    await tx
      .update(organization)
      .set({
        orgUsageLimit: creditLimits.effectiveUsageLimitDollars,
        updatedAt: new Date(),
      })
      .where(eq(organization.id, referenceId))

    // The organization lock is held across the census and all member billing
    // transitions. Add/remove/accept paths take the same lock, so a departing
    // member cannot be re-paused after their removal restores personal Pro.
    const existingMembers = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, referenceId))
      .orderBy(asc(member.userId))
    for (const existingMember of existingMembers) {
      await reapplyPaidOrgJoinBillingForExistingMemberTx(tx, existingMember.userId, referenceId)
    }

    if (correlatedOperation && typeof operationId === 'string') {
      const operationPatched = await patchOutboxEventPayload(tx, operationId, {
        applicationResult: {
          appliedAt: correlatedOperation.applicationResult?.appliedAt ?? new Date().toISOString(),
          subscriptionId: stripeSubscription.id,
        },
      })
      if (!operationPatched) {
        throw new Error(`Enterprise issuance operation ${operationId} disappeared during apply`)
      }
    }

    return {
      subscriptionId: existing?.id ?? subscriptionRow.id,
      requestedByEmail: correlatedOperation?.request.requestedByEmail ?? null,
      requestedByUserId: correlatedOperation?.request.requestedByUserId ?? null,
      operationNewlyApplied,
      hasCorrelatedOperation: Boolean(correlatedOperation),
      subscriptionNewlyInserted: !existing,
      ...creditLimits,
    }
  })

  const {
    subscriptionId,
    requestedByEmail,
    requestedByUserId,
    operationNewlyApplied,
    hasCorrelatedOperation,
    subscriptionNewlyInserted,
    includedMonthlyCredits,
    configuredUsageLimitCredits,
    prepaidCredits,
    effectiveUsageLimitCredits,
  } = coreResult
  const shouldAnnounce = hasCorrelatedOperation ? operationNewlyApplied : subscriptionNewlyInserted

  logger.info('[subscription.created] Upserted enterprise subscription', {
    subscriptionId,
    referenceId: subscriptionRow.referenceId,
    plan: subscriptionRow.plan,
    status: subscriptionRow.status,
    monthlyPrice,
    includedMonthlyCredits,
    effectiveUsageLimitCredits,
    prepaidCredits,
    seats,
    note: 'Seats from metadata, Stripe quantity set to 1',
  })

  let actorId: string | null = null
  let actorName = 'Stripe Webhook'
  let actorEmail: string | null = requestedByEmail
  try {
    const [operationUser] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        requestedByUserId
          ? eq(user.id, requestedByUserId)
          : requestedByEmail
            ? eq(user.normalizedEmail, requestedByEmail.toLowerCase())
            : eq(user.stripeCustomerId, stripeCustomerId)
      )
      .limit(1)
    actorId = operationUser?.id ?? requestedByUserId
    actorName = operationUser?.name ?? (requestedByEmail ? 'Admin Panel' : 'Stripe Webhook')
    actorEmail = operationUser?.email ?? requestedByEmail
  } catch (error) {
    logger.warn('Failed to resolve Enterprise issuance actor; falling back to reference id', {
      referenceId,
      error,
    })
  }

  if (shouldAnnounce) {
    recordAudit({
      actorId,
      actorName,
      actorEmail,
      action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: subscriptionId,
      description: `Enterprise subscription provisioned for organization ${referenceId} (${seats} seats)`,
      metadata: {
        organizationId: referenceId,
        stripeCustomerId,
        stripeSubscriptionId: stripeSubscription.id,
        seats,
        monthlyPrice,
        includedMonthlyCredits,
        configuredUsageLimitCredits,
        effectiveUsageLimitCredits,
        prepaidCredits,
        currency: 'usd',
      },
    })
    captureServerEvent(actorId ?? referenceId, 'enterprise_subscription_created', {
      reference_id: referenceId,
      seats,
      monthly_price: monthlyPrice,
      currency: 'usd',
    })
  }

  if (shouldAnnounce) {
    try {
      const userDetails = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
        })
        .from(user)
        .where(eq(user.stripeCustomerId, stripeCustomerId))
        .limit(1)

      const orgDetails = await db
        .select({
          id: organization.id,
          name: organization.name,
        })
        .from(organization)
        .where(eq(organization.id, referenceId))
        .limit(1)

      if (userDetails.length > 0 && orgDetails.length > 0) {
        const user = userDetails[0]
        const org = orgDetails[0]

        const html = await renderEnterpriseSubscriptionEmail(user.name || user.email)

        const emailResult = await sendEmail({
          to: user.email,
          subject: getEmailSubject('enterprise-subscription'),
          html,
          from: getFromEmailAddress(),
          emailType: 'transactional',
        })

        if (emailResult.success) {
          logger.info('[subscription.created] Enterprise subscription email sent successfully', {
            userId: user.id,
            email: user.email,
            organizationId: org.id,
            subscriptionId,
          })
        } else {
          logger.warn('[subscription.created] Failed to send enterprise subscription email', {
            userId: user.id,
            email: user.email,
            error: emailResult.message,
          })
        }
      } else {
        logger.warn(
          '[subscription.created] Could not find user or organization for email notification',
          {
            userFound: userDetails.length > 0,
            orgFound: orgDetails.length > 0,
            stripeCustomerId,
            referenceId,
          }
        )
      }
    } catch (emailError) {
      logger.error('[subscription.created] Error sending enterprise subscription email', {
        error: emailError,
        stripeCustomerId,
        referenceId,
        subscriptionId,
      })
    }
  }
}
