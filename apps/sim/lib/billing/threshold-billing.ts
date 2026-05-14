import { db } from '@sim/db'
import { subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { DEFAULT_OVERAGE_THRESHOLD } from '@/lib/billing/constants'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import type { BillingEntityType } from '@/lib/billing/ledger/usage-ledger'
import { createOverageBillingClaim } from '@/lib/billing/ledger/usage-ledger'
import { isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionAccess } from '@/lib/billing/subscriptions/utils'
import { env, envNumber } from '@/lib/core/config/env'

const logger = createLogger('ThresholdBilling')

const OVERAGE_THRESHOLD = envNumber(env.OVERAGE_THRESHOLD_DOLLARS, DEFAULT_OVERAGE_THRESHOLD)

export interface BillingThresholdCheckPayload {
  userId: string
  subscriptionId: string
  billingEntityType: BillingEntityType
  billingEntityId: string
}

export async function checkAndBillOverageThreshold(
  payload: BillingThresholdCheckPayload
): Promise<void> {
  try {
    const threshold = OVERAGE_THRESHOLD

    const [subscription] = await db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.id, payload.subscriptionId))
      .limit(1)

    if (!subscription) {
      logger.debug('Subscription not found for threshold billing', payload)
      return
    }

    if (payload.billingEntityType === 'organization') {
      if (subscription.referenceId !== payload.billingEntityId) {
        logger.warn('Skipping threshold billing for mismatched organization subscription', {
          ...payload,
          subscriptionReferenceId: subscription.referenceId,
        })
        return
      }

      await checkAndBillBillingEntityOverageThreshold(payload, subscription)
      return
    }

    if (subscription.referenceId !== payload.billingEntityId) {
      logger.warn('Skipping threshold billing for mismatched user subscription', {
        ...payload,
        subscriptionReferenceId: subscription.referenceId,
      })
      return
    }

    await checkAndBillBillingEntityOverageThreshold(payload, subscription)
  } catch (error) {
    logger.error('Error in threshold billing check', {
      ...payload,
      error,
    })
    throw error
  }
}

async function checkAndBillBillingEntityOverageThreshold(
  payload: BillingThresholdCheckPayload,
  subscription: typeof subscriptionTable.$inferSelect
): Promise<void> {
  const threshold = OVERAGE_THRESHOLD
  const billingBlocked =
    payload.billingEntityType === 'organization'
      ? await isOrganizationBillingBlocked(payload.billingEntityId)
      : await isUserBillingBlocked(payload.billingEntityId)

  if (!hasUsableSubscriptionAccess(subscription.status, billingBlocked)) {
    logger.debug('Subscription not usable for threshold billing', {
      ...payload,
      status: subscription.status,
      billingBlocked,
    })
    return
  }

  if (isFree(subscription.plan) || isEnterprise(subscription.plan)) {
    logger.debug('Plan not eligible for threshold billing, skipping', {
      ...payload,
      plan: subscription.plan,
    })
    return
  }

  const stripeSubscriptionId = subscription.stripeSubscriptionId
  if (!stripeSubscriptionId || !subscription.stripeCustomerId) {
    logger.error('Missing Stripe identifiers for billable threshold subscription', {
      ...payload,
      hasStripeSubscriptionId: Boolean(stripeSubscriptionId),
      hasStripeCustomerId: Boolean(subscription.stripeCustomerId),
    })
    throw new Error('Stripe customer and subscription ids are required for threshold billing')
  }
  if (!subscription.periodStart || !subscription.periodEnd) {
    throw new Error('Subscription period is required for threshold billing')
  }

  const result = await createOverageBillingClaim({
    subscription,
    claimType: 'threshold',
    threshold,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    usageCutoff: new Date(),
    skipIfLocked: true,
    customerId: subscription.stripeCustomerId,
    stripeSubscriptionId,
    description: `Threshold overage billing - ${getBillingPeriod(subscription.periodEnd)}`,
    itemDescription:
      payload.billingEntityType === 'organization' ? 'Organization usage overage' : 'Usage overage',
    enqueueStripeInvoice: true,
    metadata: {
      userId: payload.userId,
      billingEntityType: payload.billingEntityType,
      billingEntityId: payload.billingEntityId,
      subscriptionId: stripeSubscriptionId,
    },
  })
  if (result.lockSkipped) {
    throw new Error('Billing claim lock is busy; retry threshold billing check')
  }

  logger.info('Threshold billing check completed', {
    ...payload,
    plan: subscription.plan,
    claimed: result.claimed,
    claimId: result.claimId,
    amountToBill: result.amountToBill,
    creditApplied: result.creditApplied,
    overageAmount: result.overageAmount,
    priorCoveredOverage: result.priorCoveredOverage,
  })
}

async function isUserBillingBlocked(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ blocked: userStats.billingBlocked })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  return !!row?.blocked
}

function getBillingPeriod(periodEnd: Date): string {
  return periodEnd.toISOString().slice(0, 7)
}
