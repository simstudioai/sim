import { db } from '@sim/db'
import { member, organization, subscription, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { BILLING_LOCK_TIMEOUT_MS, DEFAULT_OVERAGE_THRESHOLD } from '@/lib/billing/constants'
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
import { env, envNumber } from '@/lib/core/config/env'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('ThresholdBilling')

const OVERAGE_THRESHOLD = envNumber(env.OVERAGE_THRESHOLD_DOLLARS, DEFAULT_OVERAGE_THRESHOLD)
const USAGE_TOTAL_EPSILON = 0.000001

interface PersonalUsageSnapshot {
  currentPeriodCost: number
  proPeriodCostSnapshot: number
  proPeriodCostSnapshotAt: Date | null
  lastPeriodCost: number
}

interface OrganizationUsageSnapshot {
  memberIds: string[]
  ownerId: string
  memberSignature: string
  pooledCurrentPeriodCost: number
  departedMemberUsage: number
}

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

    const usageSnapshot = await getPersonalUsageSnapshot(userId)
    if (!usageSnapshot) {
      logger.warn('User stats not found for threshold billing', { userId })
      return
    }

    const currentOverage = await calculateSubscriptionOverage({
      id: userSubscription.id,
      plan: userSubscription.plan,
      referenceId: userSubscription.referenceId,
      seats: userSubscription.seats,
      periodStart: userSubscription.periodStart,
      periodEnd: userSubscription.periodEnd,
    })

    if (currentOverage < threshold) {
      logger.debug('Threshold billing check below threshold before locking user stats', {
        userId,
        plan: userSubscription.plan,
        currentOverage,
        threshold,
      })
      return
    }

    const stripeSubscriptionId = userSubscription.stripeSubscriptionId
    if (!stripeSubscriptionId) {
      logger.error('No Stripe subscription ID found', { userId })
      return
    }

    const customerRows = await db
      .select({ stripeCustomerId: subscription.stripeCustomerId })
      .from(subscription)
      .where(eq(subscription.id, userSubscription.id))
      .limit(1)
    const customerId = customerRows[0]?.stripeCustomerId
    if (!customerId) {
      logger.error('No Stripe customer ID found', { userId, subscriptionId: userSubscription.id })
      return
    }

    const periodEnd = userSubscription.periodEnd
      ? Math.floor(userSubscription.periodEnd.getTime() / 1000)
      : Math.floor(Date.now() / 1000)
    const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)
    const totalOverageCents = Math.round(currentOverage * 100)

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${BILLING_LOCK_TIMEOUT_MS}ms'`))

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
      const lockedUsageSnapshot = personalUsageSnapshotFromStats(stats)
      if (!personalUsageSnapshotMatches(usageSnapshot, lockedUsageSnapshot)) {
        logger.debug('Personal usage changed during threshold billing check; retry later', {
          userId,
          usageSnapshot,
          lockedUsageSnapshot,
        })
        return
      }

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

      const amountCents = Math.round(amountToBill * 100)

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

async function checkAndBillOrganizationOverageThreshold(organizationId: string): Promise<void> {
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

    const memberUsageRows = await db
      .select({
        userId: member.userId,
        role: member.role,
        currentPeriodCost: userStats.currentPeriodCost,
        departedMemberUsage: organization.departedMemberUsage,
      })
      .from(member)
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.organizationId, organizationId))

    logger.debug('Found organization members', {
      organizationId,
      memberCount: memberUsageRows.length,
      members: memberUsageRows.map((m) => ({ userId: m.userId, role: m.role })),
    })

    if (memberUsageRows.length === 0) {
      logger.warn('No members found for organization', { organizationId })
      return
    }

    const usageSnapshot = buildOrganizationUsageSnapshot(memberUsageRows)
    if (!usageSnapshot) {
      logger.error(
        'Organization has no owner when running threshold billing — data integrity issue, skipping',
        { organizationId }
      )
      return
    }

    logger.debug('Found organization owner, starting transaction', {
      organizationId,
      ownerId: usageSnapshot.ownerId,
    })

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
      pooledCurrentPeriodCost: usageSnapshot.pooledCurrentPeriodCost,
      departedMemberUsage: usageSnapshot.departedMemberUsage,
      memberIds: usageSnapshot.memberIds,
    })

    if (currentOverage < threshold) {
      logger.debug('Organization threshold billing check below threshold before locking', {
        organizationId,
        totalTeamUsage: usageSnapshot.pooledCurrentPeriodCost + usageSnapshot.departedMemberUsage,
        effectiveTeamUsage,
        basePrice,
        currentOverage,
        threshold,
      })
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

    const periodEnd = orgSubscription.periodEnd
      ? Math.floor(orgSubscription.periodEnd.getTime() / 1000)
      : Math.floor(Date.now() / 1000)
    const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)
    const totalOverageCents = Math.round(currentOverage * 100)

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${BILLING_LOCK_TIMEOUT_MS}ms'`))

      const lockedOwnerRows = await tx
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
        .for('update')
        .limit(1)
      const lockedOwnerId = lockedOwnerRows[0]?.userId
      if (!lockedOwnerId) {
        logger.error('Organization owner not found after locking organization', { organizationId })
        return
      }

      const ownerStatsLock = await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, lockedOwnerId))
        .for('update')
        .limit(1)
      if (ownerStatsLock.length === 0) {
        logger.error('Owner stats not found', { organizationId, ownerId: lockedOwnerId })
        return
      }

      const orgLock = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for('update')
        .limit(1)

      if (orgLock.length === 0) {
        logger.error('Organization not found', { organizationId })
        return
      }

      const lockedMemberUsageRows = await tx
        .select({
          userId: member.userId,
          role: member.role,
          currentPeriodCost: userStats.currentPeriodCost,
          departedMemberUsage: organization.departedMemberUsage,
        })
        .from(member)
        .leftJoin(userStats, eq(member.userId, userStats.userId))
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.organizationId, organizationId))

      const lockedUsageSnapshot = buildOrganizationUsageSnapshot(lockedMemberUsageRows)
      if (
        !lockedUsageSnapshot ||
        lockedOwnerId !== usageSnapshot.ownerId ||
        !organizationUsageSnapshotMatches(usageSnapshot, lockedUsageSnapshot)
      ) {
        logger.debug('Organization usage changed during threshold billing check; retry later', {
          organizationId,
          usageSnapshot,
          lockedUsageSnapshot,
          lockedOwnerId,
        })
        return
      }

      const totalBilledOverage = toNumber(toDecimal(ownerStatsLock[0].billedOverageThisPeriod))
      const orgCreditBalance = toNumber(toDecimal(orgLock[0].creditBalance))

      const unbilledOverage = Math.max(0, currentOverage - totalBilledOverage)

      logger.debug('Organization threshold billing check', {
        organizationId,
        totalTeamUsage: usageSnapshot.pooledCurrentPeriodCost + usageSnapshot.departedMemberUsage,
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
          .where(eq(userStats.userId, lockedOwnerId))

        logger.info('Credits fully covered org threshold overage', {
          organizationId,
          creditsApplied,
          unbilledOverage,
        })
        return
      }

      const amountCents = Math.round(amountToBill * 100)

      // Bump billed tracker and enqueue Stripe invoice atomically.
      // See user-path above for the full retry-invariant reasoning.
      await tx
        .update(userStats)
        .set({
          billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${unbilledOverage}`,
        })
        .where(eq(userStats.userId, lockedOwnerId))

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
        ownerId: lockedOwnerId,
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

async function getPersonalUsageSnapshot(userId: string): Promise<PersonalUsageSnapshot | null> {
  const [stats] = await db
    .select({
      currentPeriodCost: userStats.currentPeriodCost,
      proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
      proPeriodCostSnapshotAt: userStats.proPeriodCostSnapshotAt,
      lastPeriodCost: userStats.lastPeriodCost,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  return stats ? personalUsageSnapshotFromStats(stats) : null
}

function personalUsageSnapshotFromStats(stats: {
  currentPeriodCost: string | number | null
  proPeriodCostSnapshot: string | number | null
  proPeriodCostSnapshotAt: Date | null
  lastPeriodCost: string | number | null
}): PersonalUsageSnapshot {
  return {
    currentPeriodCost: toNumber(toDecimal(stats.currentPeriodCost)),
    proPeriodCostSnapshot: toNumber(toDecimal(stats.proPeriodCostSnapshot)),
    proPeriodCostSnapshotAt: stats.proPeriodCostSnapshotAt,
    lastPeriodCost: toNumber(toDecimal(stats.lastPeriodCost)),
  }
}

function personalUsageSnapshotMatches(
  expected: PersonalUsageSnapshot,
  actual: PersonalUsageSnapshot
): boolean {
  return (
    Math.abs(expected.currentPeriodCost - actual.currentPeriodCost) <= USAGE_TOTAL_EPSILON &&
    Math.abs(expected.proPeriodCostSnapshot - actual.proPeriodCostSnapshot) <=
      USAGE_TOTAL_EPSILON &&
    Math.abs(expected.lastPeriodCost - actual.lastPeriodCost) <= USAGE_TOTAL_EPSILON &&
    nullableDateTime(expected.proPeriodCostSnapshotAt) ===
      nullableDateTime(actual.proPeriodCostSnapshotAt)
  )
}

function buildOrganizationUsageSnapshot(
  rows: {
    userId: string
    role: string
    currentPeriodCost: string | number | null
    departedMemberUsage: string | number | null
  }[]
): OrganizationUsageSnapshot | null {
  const owner = rows.find((row) => row.role === 'owner')
  if (!owner) return null

  const sortedRows = [...rows].sort((a, b) => a.userId.localeCompare(b.userId))
  let pooledCurrentPeriodCost = 0
  for (const row of sortedRows) {
    pooledCurrentPeriodCost += toNumber(toDecimal(row.currentPeriodCost))
  }

  return {
    memberIds: sortedRows.map((row) => row.userId),
    ownerId: owner.userId,
    memberSignature: sortedRows
      .map(
        (row) =>
          `${row.userId}:${row.role}:${toNumber(toDecimal(row.currentPeriodCost)).toFixed(6)}`
      )
      .join('|'),
    pooledCurrentPeriodCost,
    departedMemberUsage: toNumber(toDecimal(owner.departedMemberUsage)),
  }
}

function organizationUsageSnapshotMatches(
  expected: OrganizationUsageSnapshot,
  actual: OrganizationUsageSnapshot
): boolean {
  return (
    expected.ownerId === actual.ownerId &&
    expected.memberSignature === actual.memberSignature &&
    Math.abs(expected.departedMemberUsage - actual.departedMemberUsage) <= USAGE_TOTAL_EPSILON
  )
}

function nullableDateTime(value: Date | null): number | null {
  return value?.getTime() ?? null
}
