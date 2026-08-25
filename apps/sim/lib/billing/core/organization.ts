import { db } from '@sim/db'
import { member, organization, usageLog, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { getOrganizationSubscription, getPlanPricing } from '@/lib/billing/core/billing'
import { resolveSubscriptionUsagePeriodOrDefault } from '@/lib/billing/core/reporting-period'
import {
  getBillingPeriodUsageCost,
  getBillingPeriodUsageCostByUser,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { computeDailyRefreshConsumed } from '@/lib/billing/credits/daily-refresh'
import { getPlanTierDollars, isEnterprise, isPaid } from '@/lib/billing/plan-helpers'
import {
  getEffectiveSeats,
  getFreeTierLimit,
  hasUsableSubscriptionStatus,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { countPendingSeatInvitations } from '@/lib/billing/validation/seat-management'
import type { DbClient } from '@/lib/db/types'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('OrganizationBilling')

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

interface OrganizationUsageData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: number
  totalUsageLimit: number
  minimumBillingAmount: number
  averageUsagePerMember: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  membersTotal: number
  memberPagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
  membersOverLimit: number
  membersNearLimit: number
  members: MemberUsageData[]
}

interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: Date
}

/**
 * Per-member usage_log cost for an org's current billing period, keyed by
 * userId — each member's real current-period usage. Pass `period` to reuse an
 * already-fetched subscription window; omit it to look up the org's
 * subscription here. Returns an empty map when there's no period.
 */
export async function getOrgMemberLedgerByUser(
  organizationId: string,
  period?: UsageQueryPeriod | null,
  executor: DbClient = db,
  userIds?: readonly string[]
): Promise<Map<string, number>> {
  let billingPeriod = period ?? null
  if (period === undefined) {
    const subscription = await getOrganizationSubscription(organizationId, { executor })
    billingPeriod = subscription ? resolveSubscriptionUsagePeriodOrDefault(subscription) : null
  }
  if (!billingPeriod) return new Map<string, number>()
  return getBillingPeriodUsageCostByUser(
    { type: 'organization', id: organizationId },
    billingPeriod,
    undefined,
    executor,
    userIds
  )
}

export interface OrganizationMemberUsageSnapshot {
  billingPeriod: UsageQueryPeriod | null
  usageByUser: Map<string, number>
}

const DEFAULT_ORGANIZATION_BILLING_MEMBER_LIMIT = 50
const MAX_ORGANIZATION_BILLING_MEMBER_LIMIT = 100

async function getOrganizationMemberUsageCounts(
  organizationId: string,
  billingPeriod: UsageQueryPeriod,
  executor: DbClient
): Promise<{ overLimit: number; nearLimit: number }> {
  const currentUsage = sql<number>`coalesce(sum(${usageLog.cost}), 0)`
    .mapWith(Number)
    .as('current_usage')
  const usageLimit = sql<number>`coalesce(${userStats.currentUsageLimit}, ${getFreeTierLimit()})`
    .mapWith(Number)
    .as('usage_limit')
  const perMemberUsage = executor
    .select({ currentUsage, usageLimit })
    .from(member)
    .leftJoin(userStats, eq(userStats.userId, member.userId))
    .leftJoin(
      usageLog,
      and(
        eq(usageLog.userId, member.userId),
        eq(usageLog.billingEntityType, 'organization'),
        eq(usageLog.billingEntityId, organizationId),
        ...(billingPeriod.source === 'reporting'
          ? [
              gte(usageLog.createdAt, billingPeriod.start),
              lt(usageLog.createdAt, billingPeriod.end),
            ]
          : [
              eq(usageLog.billingPeriodStart, billingPeriod.start),
              eq(usageLog.billingPeriodEnd, billingPeriod.end),
            ])
      )
    )
    .where(eq(member.organizationId, organizationId))
    .groupBy(member.userId, userStats.currentUsageLimit)
    .as('organization_member_usage')

  const [counts] = await executor
    .select({
      overLimit:
        sql<number>`count(*) filter (where ${perMemberUsage.currentUsage} > ${perMemberUsage.usageLimit})`.mapWith(
          Number
        ),
      nearLimit:
        sql<number>`count(*) filter (where ${perMemberUsage.usageLimit} > 0 and ${perMemberUsage.currentUsage} <= ${perMemberUsage.usageLimit} and ${perMemberUsage.currentUsage} / ${perMemberUsage.usageLimit} >= 0.8)`.mapWith(
          Number
        ),
    })
    .from(perMemberUsage)

  return {
    overLimit: counts?.overLimit ?? 0,
    nearLimit: counts?.nearLimit ?? 0,
  }
}

/**
 * Resolves the organization's usage period once and returns the ledger usage
 * for only the requested actors.
 */
export async function getOrganizationMemberUsageSnapshot(
  organizationId: string,
  options: {
    executor?: DbClient
    userIds?: readonly string[]
  } = {}
): Promise<OrganizationMemberUsageSnapshot> {
  const executor = options.executor ?? db
  const subscription = await getOrganizationSubscription(organizationId, { executor })
  const billingPeriod = subscription ? resolveSubscriptionUsagePeriodOrDefault(subscription) : null
  return {
    billingPeriod,
    usageByUser: billingPeriod
      ? await getOrgMemberLedgerByUser(organizationId, billingPeriod, executor, options.userIds)
      : new Map(),
  }
}

/**
 * Get comprehensive organization billing and usage data
 */
export async function getOrganizationBillingData(
  organizationId: string,
  executor: DbClient = db,
  memberPage: { limit?: number; offset?: number } = {}
): Promise<OrganizationUsageData | null> {
  try {
    // Get organization info
    const orgRecord = await executor
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      logger.warn('Organization not found', { organizationId })
      return null
    }

    const organizationData = orgRecord[0]

    // Get organization subscription directly (referenceId = organizationId)
    const subscription = await getOrganizationSubscription(organizationId, { executor })

    if (!subscription) {
      logger.warn('No subscription found for organization', { organizationId })
      return null
    }

    const billingPeriod = resolveSubscriptionUsagePeriodOrDefault(subscription)
    const limit = Math.min(
      MAX_ORGANIZATION_BILLING_MEMBER_LIMIT,
      Math.max(1, memberPage.limit ?? DEFAULT_ORGANIZATION_BILLING_MEMBER_LIMIT)
    )
    const offset = Math.max(0, memberPage.offset ?? 0)
    const [memberAggregateRows, membersWithUsage] = await Promise.all([
      executor
        .select({ total: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId)),
      executor
        .select({
          userId: member.userId,
          userName: user.name,
          userEmail: user.email,
          role: member.role,
          joinedAt: member.createdAt,
          currentUsageLimit: userStats.currentUsageLimit,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(member.userId, userStats.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(user.name, user.id)
        .limit(limit)
        .offset(offset),
    ])
    const memberIds = membersWithUsage.map((row) => row.userId)
    const usageByUser = billingPeriod
      ? await getOrgMemberLedgerByUser(organizationId, billingPeriod, executor, memberIds)
      : new Map<string, number>()

    const members: MemberUsageData[] = membersWithUsage.map((memberRecord) => {
      const currentUsage = usageByUser.get(memberRecord.userId) ?? 0
      const usageLimit = Number(memberRecord.currentUsageLimit || getFreeTierLimit())
      const percentUsed = usageLimit > 0 ? (currentUsage / usageLimit) * 100 : 0

      return {
        userId: memberRecord.userId,
        userName: memberRecord.userName,
        userEmail: memberRecord.userEmail,
        currentUsage,
        usageLimit,
        percentUsed: Math.round(percentUsed * 100) / 100,
        isOverLimit: currentUsage > usageLimit,
        role: memberRecord.role,
        joinedAt: memberRecord.joinedAt,
      }
    })

    const memberAggregate = memberAggregateRows[0]
    const membersTotal = memberAggregate?.total ?? 0
    let totalCurrentUsage = billingPeriod
      ? await getBillingPeriodUsageCost(
          { type: 'organization', id: subscription.referenceId },
          billingPeriod,
          undefined,
          executor
        )
      : 0

    if (isPaid(subscription.plan) && subscription.periodStart) {
      const planDollars = getPlanTierDollars(subscription.plan)
      if (planDollars > 0) {
        const refreshConsumed = await computeDailyRefreshConsumed(
          {
            billingEntity: { type: 'organization', id: subscription.referenceId },
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd ?? null,
            planDollars,
            seats: subscription.seats || 1,
          },
          executor
        )
        totalCurrentUsage = Math.max(0, totalCurrentUsage - refreshConsumed)
      }
    }

    const { basePrice: pricePerSeat } = getPlanPricing(subscription.plan)

    // Stripe subscription quantity; `||` not `??` because 0 seats is
    // never valid for a paid sub — fall through to 1.
    const licensedSeats = subscription.seats || 1

    // UI seat count — metadata.seats on enterprise (column is always 1).
    const effectiveSeats = getEffectiveSeats(subscription)

    let minimumBillingAmount: number
    let totalUsageLimit: number

    if (isEnterprise(subscription.plan)) {
      const configuredLimit = toNumber(toDecimal(organizationData.orgUsageLimit))
      minimumBillingAmount = configuredLimit
      totalUsageLimit = configuredLimit
    } else {
      minimumBillingAmount = licensedSeats * pricePerSeat

      const configuredLimit = organizationData.orgUsageLimit
        ? toNumber(toDecimal(organizationData.orgUsageLimit))
        : null
      totalUsageLimit =
        configuredLimit !== null
          ? Math.max(configuredLimit, minimumBillingAmount)
          : minimumBillingAmount
    }

    const averageUsagePerMember = membersTotal > 0 ? totalCurrentUsage / membersTotal : 0

    const pendingSeats = await countPendingSeatInvitations(organizationId, executor)
    const usedSeats = membersTotal + pendingSeats
    const memberUsageCounts = billingPeriod
      ? await getOrganizationMemberUsageCounts(organizationId, billingPeriod, executor)
      : { overLimit: 0, nearLimit: 0 }

    const billingPeriodStart = billingPeriod?.start ?? null
    const billingPeriodEnd = billingPeriod?.end ?? null

    return {
      organizationId,
      organizationName: organizationData.name || '',
      subscriptionPlan: subscription.plan,
      subscriptionStatus: subscription.status || 'inactive',
      totalSeats: effectiveSeats,
      usedSeats,
      seatsCount: licensedSeats,
      totalCurrentUsage: roundCurrency(totalCurrentUsage),
      totalUsageLimit: roundCurrency(totalUsageLimit),
      minimumBillingAmount: roundCurrency(minimumBillingAmount),
      averageUsagePerMember: roundCurrency(averageUsagePerMember),
      billingPeriodStart,
      billingPeriodEnd,
      membersTotal,
      memberPagination: {
        total: membersTotal,
        limit,
        offset,
        hasMore: offset + members.length < membersTotal,
      },
      membersOverLimit: memberUsageCounts.overLimit,
      membersNearLimit: memberUsageCounts.nearLimit,
      members,
    }
  } catch (error) {
    logger.error('Failed to get organization billing data', { organizationId, error })
    throw error
  }
}

/**
 * Update organization usage limit (cap)
 */
export async function updateOrganizationUsageLimit(
  organizationId: string,
  newLimit: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate the organization exists
    const orgRecord = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      return { success: false, error: 'Organization not found' }
    }

    // Get subscription to validate minimum
    const subscription = await getOrganizationSubscription(organizationId)
    if (!subscription) {
      return { success: false, error: 'No active subscription found' }
    }

    if (
      !hasUsableSubscriptionStatus(subscription.status) ||
      (await isOrganizationBillingBlocked(organizationId))
    ) {
      return { success: false, error: 'An active subscription is required to edit usage limits' }
    }

    if (isEnterprise(subscription.plan)) {
      return {
        success: false,
        error: 'Enterprise plans have fixed usage limits that cannot be changed',
      }
    }

    if (!isPaid(subscription.plan)) {
      return {
        success: false,
        error: 'Organization is not on a paid plan',
      }
    }

    const { basePrice } = getPlanPricing(subscription.plan)
    const seatCount = subscription.seats || 1
    const minimumLimit = seatCount * basePrice

    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be less than minimum billing amount of $${roundCurrency(minimumLimit).toFixed(2)}`,
      }
    }

    await db
      .update(organization)
      .set({
        orgUsageLimit: roundCurrency(newLimit).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, organizationId))

    logger.info('Organization usage limit updated', {
      organizationId,
      newLimit,
      minimumLimit,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update organization usage limit', {
      organizationId,
      newLimit,
      error,
    })
    return {
      success: false,
      error: 'Failed to update usage limit',
    }
  }
}

/**
 * Error-tolerant wrapper around {@link isOrganizationAdminOrOwner} for billing
 * gates: on a DB error it logs and returns false instead of throwing, so a
 * transient failure denies access rather than surfacing a 500 mid-checkout.
 * Prefer the canonical {@link isOrganizationAdminOrOwner} when a thrown error
 * should propagate.
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization
 * @returns Promise<boolean> - True if the user is an owner or admin of the organization
 */
export async function isOrganizationOwnerOrAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  try {
    return await isOrganizationAdminOrOwner(userId, organizationId)
  } catch (error) {
    logger.error('Error checking organization ownership/admin status:', error)
    return false
  }
}
