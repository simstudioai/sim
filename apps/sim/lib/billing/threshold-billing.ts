import { db } from '@sim/db'
import { member, organization, subscription, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_OVERAGE_THRESHOLD } from '@/lib/billing/constants'
import { getEffectiveBillingStatus, isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { calculateSubscriptionOverage, computeOrgOverageAmount } from '@/lib/billing/core/billing'
import {
  getHighestPrioritySubscription,
  getOrganizationSubscriptionUsable,
} from '@/lib/billing/core/subscription'
import { isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import {
  hasUsableSubscriptionAccess,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('ThresholdBilling')

const OVERAGE_THRESHOLD = env.OVERAGE_THRESHOLD_DOLLARS || DEFAULT_OVERAGE_THRESHOLD

export async function checkAndBillOverageThreshold(userId: string): Promise<void> {
  try {
    const threshold = OVERAGE_THRESHOLD

    const userSubscription = await getHighestPrioritySubscription(userId)
    const billingStatus = await getEffectiveBillingStatus(userId)

    if (
      !userSubscription ||
      !hasUsableSubscriptionAccess(userSubscription.status, billingStatus.billingBlocked)
    ) {
      logger.debug('No active subscription for threshold billing', { userId })
      return
    }

    if (isFree(userSubscription.plan) || isEnterprise(userSubscription.plan)) {
      return
    }

    // Org-scoped subs are billed at the org level regardless of plan name.
    if (isOrgScopedSubscription(userSubscription, userId)) {
      logger.debug('Org-scoped subscription detected - triggering org-level threshold billing', {
        userId,
        organizationId: userSubscription.referenceId,
        plan: userSubscription.plan,
      })
      await checkAndBillOrganizationOverageThreshold(userSubscription.referenceId)
      return
    }

    await db.transaction(async (tx) => {
      const statsRecords = await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .for('update')
        .limit(1)

      if (statsRecords.length === 0) {
        logger.warn('User stats not found for threshold billing', { userId })
        return
      }

      const stats = statsRecords[0]

      const currentOverage = await calculateSubscriptionOverage({
        id: userSubscription.id,
        plan: userSubscription.plan,
        referenceId: userSubscription.referenceId,
        seats: userSubscription.seats,
        periodStart: userSubscription.periodStart,
        periodEnd: userSubscription.periodEnd,
      })
      const billedOverageThisPeriod = toNumber(toDecimal(stats.billedOverageThisPeriod))
      const unbilledOverage = Math.max(0, currentOverage - billedOverageThisPeriod)

      logger.debug('Threshold billing check', {
        userId,
        plan: userSubscription.plan,
        currentOverage,
        billedOverageThisPeriod,
        unbilledOverage,
        threshold,
      })

      if (unbilledOverage < threshold) {
        return
      }

      const stripeSubscriptionId = userSubscription.stripeSubscriptionId
      if (!stripeSubscriptionId) {
        logger.error('No Stripe subscription ID found', { userId })
        return
      }

      const customerRows = await tx
        .select({ stripeCustomerId: subscription.stripeCustomerId })
        .from(subscription)
        .where(eq(subscription.id, userSubscription.id))
        .limit(1)
      const customerId = customerRows[0]?.stripeCustomerId
      if (!customerId) {
        logger.error('No Stripe customer ID found', { userId, subscriptionId: userSubscription.id })
        return
      }

      // Apply credits to reduce the amount to bill (use stats from locked row)
      let amountToBill = unbilledOverage
      let creditsApplied = 0
      const creditBalance = toNumber(toDecimal(stats.creditBalance))

      if (creditBalance > 0) {
        creditsApplied = Math.min(creditBalance, amountToBill)
        await tx
          .update(userStats)
          .set({
            creditBalance: sql`GREATEST(0, ${userStats.creditBalance} - ${creditsApplied})`,
          })
          .where(eq(userStats.userId, userId))
        amountToBill = amountToBill - creditsApplied

        logger.info('Applied credits to reduce threshold overage', {
          userId,
          creditBalance,
          creditsApplied,
          remainingToBill: amountToBill,
        })
      }

      // If credits covered everything, bump billed tracker but don't enqueue Stripe invoice.
      if (amountToBill <= 0) {
        await tx
          .update(userStats)
          .set({
            billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${unbilledOverage}`,
          })
          .where(eq(userStats.userId, userId))

        logger.info('Credits fully covered threshold overage', {
          userId,
          creditsApplied,
          unbilledOverage,
        })
        return
      }

      const periodEnd = userSubscription.periodEnd
        ? Math.floor(userSubscription.periodEnd.getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)
      const amountCents = Math.round(amountToBill * 100)
      const totalOverageCents = Math.round(currentOverage * 100)

      await tx
        .update(userStats)
        .set({
          billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${unbilledOverage}`,
        })
        .where(eq(userStats.userId, userId))

      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE, {
        customerId,
        stripeSubscriptionId,
        amountCents,
        description: `Threshold overage billing – ${billingPeriod}`,
        itemDescription: `Usage overage ($${amountToBill.toFixed(2)})`,
        billingPeriod,
        invoiceIdemKeyStem: `threshold-overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`,
        itemIdemKeyStem: `threshold-overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`,
        metadata: {
          type: 'overage_threshold_billing',
          userId,
          subscriptionId: stripeSubscriptionId,
          billingPeriod,
          totalOverageAtTimeOfBilling: currentOverage.toFixed(2),
        },
      })

      logger.info('Queued threshold overage invoice for Stripe', {
        userId,
        plan: userSubscription.plan,
        amountToBill,
        billingPeriod,
        creditsApplied,
        totalProcessed: unbilledOverage,
        newBilledTotal: billedOverageThisPeriod + unbilledOverage,
      })
    })
  } catch (error) {
    logger.error('Error in threshold billing check', {
      userId,
      error,
    })
  }
}

export async function checkAndBillOrganizationOverageThreshold(
  organizationId: string
): Promise<void> {
  logger.info('=== ENTERED checkAndBillOrganizationOverageThreshold ===', { organizationId })

  try {
    const threshold = OVERAGE_THRESHOLD

    if (await isOrganizationBillingBlocked(organizationId)) {
      logger.debug('Organization billing blocked for threshold billing', { organizationId })
      return
    }

    logger.debug('Starting organization threshold billing check', { organizationId, threshold })

    const orgSubscription = await getOrganizationSubscriptionUsable(organizationId)

    if (!orgSubscription) {
      logger.debug('No active subscription for organization', { organizationId })
      return
    }
    logger.debug('Found organization subscription', {
      organizationId,
      plan: orgSubscription.plan,
      seats: orgSubscription.seats,
      stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
    })

    if (isEnterprise(orgSubscription.plan) || isFree(orgSubscription.plan)) {
      logger.debug('Organization plan not eligible for overage billing, skipping', {
        organizationId,
        plan: orgSubscription.plan,
      })
      return
    }

    const members = await db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    logger.debug('Found organization members', {
      organizationId,
      memberCount: members.length,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
    })

    if (members.length === 0) {
      logger.warn('No members found for organization', { organizationId })
      return
    }

    const owner = members.find((m) => m.role === 'owner')
    if (!owner) {
      logger.error(
        'Organization has no owner when running threshold billing — data integrity issue, skipping',
        { organizationId }
      )
      return
    }

    logger.debug('Found organization owner, starting transaction', {
      organizationId,
      ownerId: owner.userId,
    })

    await db.transaction(async (tx) => {
      // Lock both owner stats and organization rows
      const ownerStatsLock = await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, owner.userId))
        .for('update')
        .limit(1)

      const orgLock = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for('update')
        .limit(1)

      if (ownerStatsLock.length === 0) {
        logger.error('Owner stats not found', { organizationId, ownerId: owner.userId })
        return
      }

      if (orgLock.length === 0) {
        logger.error('Organization not found', { organizationId })
        return
      }

      let pooledCurrentPeriodCost = toNumber(toDecimal(ownerStatsLock[0].currentPeriodCost))
      const totalBilledOverage = toNumber(toDecimal(ownerStatsLock[0].billedOverageThisPeriod))
      const orgCreditBalance = toNumber(toDecimal(orgLock[0].creditBalance))

      const nonOwnerIds = members.filter((m) => m.userId !== owner.userId).map((m) => m.userId)

      if (nonOwnerIds.length > 0) {
        const memberStatsRows = await tx
          .select({
            userId: userStats.userId,
            currentPeriodCost: userStats.currentPeriodCost,
          })
          .from(userStats)
          .where(inArray(userStats.userId, nonOwnerIds))

        for (const stats of memberStatsRows) {
          pooledCurrentPeriodCost += toNumber(toDecimal(stats.currentPeriodCost))
        }
      }

      const departedMemberUsage = toNumber(toDecimal(orgLock[0].departedMemberUsage))

      const {
        totalOverage: currentOverage,
        baseSubscriptionAmount: basePrice,
        effectiveUsage: effectiveTeamUsage,
      } = await computeOrgOverageAmount({
        plan: orgSubscription.plan,
        seats: orgSubscription.seats ?? null,
        periodStart: orgSubscription.periodStart ?? null,
        periodEnd: orgSubscription.periodEnd ?? null,
        organizationId,
        pooledCurrentPeriodCost,
        departedMemberUsage,
        memberIds: members.map((m) => m.userId),
      })

      const unbilledOverage = Math.max(0, currentOverage - totalBilledOverage)

      logger.debug('Organization threshold billing check', {
        organizationId,
        totalTeamUsage: pooledCurrentPeriodCost + departedMemberUsage,
        effectiveTeamUsage,
        basePrice,
        currentOverage,
        totalBilledOverage,
        unbilledOverage,
        threshold,
      })

      if (unbilledOverage < threshold) {
        return
      }

      // Validate Stripe identifiers BEFORE mutating credits/trackers.
      const stripeSubscriptionId = orgSubscription.stripeSubscriptionId
      if (!stripeSubscriptionId) {
        logger.error('No Stripe subscription ID for organization', { organizationId })
        return
      }

      const customerId = orgSubscription.stripeCustomerId
      if (!customerId) {
        logger.error('No Stripe customer ID for organization', { organizationId })
        return
      }

      let amountToBill = unbilledOverage
      let creditsApplied = 0

      if (orgCreditBalance > 0) {
        creditsApplied = Math.min(orgCreditBalance, amountToBill)
        await tx
          .update(organization)
          .set({
            creditBalance: sql`GREATEST(0, ${organization.creditBalance} - ${creditsApplied})`,
          })
          .where(eq(organization.id, organizationId))
        amountToBill = amountToBill - creditsApplied

        logger.info('Applied org credits to reduce threshold overage', {
          organizationId,
          creditBalance: orgCreditBalance,
          creditsApplied,
          remainingToBill: amountToBill,
        })
      }

      // If credits covered everything, bump billed tracker but don't enqueue Stripe invoice.
      if (amountToBill <= 0) {
        await tx
          .update(userStats)
          .set({
            billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${unbilledOverage}`,
          })
          .where(eq(userStats.userId, owner.userId))

        logger.info('Credits fully covered org threshold overage', {
          organizationId,
          creditsApplied,
          unbilledOverage,
        })
        return
      }

      const periodEnd = orgSubscription.periodEnd
        ? Math.floor(orgSubscription.periodEnd.getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)
      const amountCents = Math.round(amountToBill * 100)
      const totalOverageCents = Math.round(currentOverage * 100)

      // Bump billed tracker and enqueue Stripe invoice atomically.
      // See user-path above for the full retry-invariant reasoning.
      await tx
        .update(userStats)
        .set({
          billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${unbilledOverage}`,
        })
        .where(eq(userStats.userId, owner.userId))

      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE, {
        customerId,
        stripeSubscriptionId,
        amountCents,
        description: `Team threshold overage billing – ${billingPeriod}`,
        itemDescription: `Team usage overage ($${amountToBill.toFixed(2)})`,
        billingPeriod,
        invoiceIdemKeyStem: `threshold-overage-org-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`,
        itemIdemKeyStem: `threshold-overage-org-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`,
        metadata: {
          type: 'overage_threshold_billing_org',
          organizationId,
          subscriptionId: stripeSubscriptionId,
          billingPeriod,
          totalOverageAtTimeOfBilling: currentOverage.toFixed(2),
        },
      })

      logger.info('Queued organization threshold overage invoice for Stripe', {
        organizationId,
        ownerId: owner.userId,
        creditsApplied,
        amountBilled: amountToBill,
        totalProcessed: unbilledOverage,
        billingPeriod,
      })
    })
  } catch (error) {
    logger.error('Error in organization threshold billing', {
      organizationId,
      error,
    })
  }
}
