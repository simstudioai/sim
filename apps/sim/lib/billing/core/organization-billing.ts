import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { getHighestPrioritySubscription } from './subscription'

const logger = createLogger('OrganizationBilling')

interface OrganizationUsageData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  totalCurrentUsage: number
  totalUsageLimit: number
  averageUsagePerMember: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
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
  lastActive: Date | null
}

/**
 * Get comprehensive organization billing and usage data
 */
export async function getOrganizationBillingData(
  organizationId: string
): Promise<OrganizationUsageData | null> {
  try {
    // Get organization info
    const orgRecord = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      logger.warn('Organization not found', { organizationId })
      return null
    }

    const organization = orgRecord[0]

    // Get organization subscription
    const subscription = await getHighestPrioritySubscription(organizationId)

    if (!subscription) {
      logger.warn('No subscription found for organization', { organizationId })
      return null
    }

    // Get all organization members with their usage data
    const membersWithUsage = await db
      .select({
        userId: schema.member.userId,
        userName: schema.user.name,
        userEmail: schema.user.email,
        role: schema.member.role,
        joinedAt: schema.member.createdAt,
        // User stats fields
        currentPeriodCost: schema.userStats.currentPeriodCost,
        currentUsageLimit: schema.userStats.currentUsageLimit,
        billingPeriodStart: schema.userStats.billingPeriodStart,
        billingPeriodEnd: schema.userStats.billingPeriodEnd,
        lastActive: schema.userStats.lastActive,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .leftJoin(schema.userStats, eq(schema.member.userId, schema.userStats.userId))
      .where(eq(schema.member.organizationId, organizationId))

    // Process member data
    const members: MemberUsageData[] = membersWithUsage.map((member) => {
      const currentUsage = Number(member.currentPeriodCost || 0)
      const usageLimit = Number(member.currentUsageLimit || 5)
      const percentUsed = usageLimit > 0 ? (currentUsage / usageLimit) * 100 : 0

      return {
        userId: member.userId,
        userName: member.userName,
        userEmail: member.userEmail,
        currentUsage,
        usageLimit,
        percentUsed: Math.round(percentUsed * 100) / 100,
        isOverLimit: currentUsage > usageLimit,
        role: member.role,
        joinedAt: member.joinedAt,
        lastActive: member.lastActive,
      }
    })

    // Calculate aggregated statistics
    const totalCurrentUsage = members.reduce((sum, member) => sum + member.currentUsage, 0)
    const totalUsageLimit = members.reduce((sum, member) => sum + member.usageLimit, 0)
    const averageUsagePerMember = members.length > 0 ? totalCurrentUsage / members.length : 0

    // Get billing period from first member (should be consistent across org)
    const firstMember = membersWithUsage[0]
    const billingPeriodStart = firstMember?.billingPeriodStart || null
    const billingPeriodEnd = firstMember?.billingPeriodEnd || null

    return {
      organizationId,
      organizationName: organization.name,
      subscriptionPlan: subscription.plan,
      subscriptionStatus: subscription.status || 'active',
      totalSeats: subscription.seats || 1,
      usedSeats: members.length,
      totalCurrentUsage: Math.round(totalCurrentUsage * 100) / 100,
      totalUsageLimit: Math.round(totalUsageLimit * 100) / 100,
      averageUsagePerMember: Math.round(averageUsagePerMember * 100) / 100,
      billingPeriodStart,
      billingPeriodEnd,
      members: members.sort((a, b) => b.currentUsage - a.currentUsage), // Sort by usage desc
    }
  } catch (error) {
    logger.error('Failed to get organization billing data', { organizationId, error })
    throw error
  }
}

/**
 * Update usage limit for a specific organization member
 */
export async function updateMemberUsageLimit(
  organizationId: string,
  memberId: string,
  newLimit: number,
  adminUserId: string
): Promise<void> {
  try {
    // Verify admin has permission to modify limits
    const adminMember = await db
      .select()
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, adminUserId))
      )
      .limit(1)

    if (adminMember.length === 0 || !['owner', 'admin'].includes(adminMember[0].role)) {
      throw new Error('Insufficient permissions to modify usage limits')
    }

    // Verify member exists in organization
    const targetMember = await db
      .select()
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, memberId))
      )
      .limit(1)

    if (targetMember.length === 0) {
      throw new Error('Member not found in organization')
    }

    // Get organization subscription to validate limit
    const subscription = await getHighestPrioritySubscription(organizationId)
    if (!subscription) {
      throw new Error('No active subscription found')
    }

    // Validate minimum limit based on plan
    const planLimits = {
      free: 5,
      pro: 20,
      team: 40,
      enterprise: 100, // Default, can be overridden by metadata
    }

    let minimumLimit = planLimits[subscription.plan as keyof typeof planLimits] || 5

    // For enterprise, check metadata for custom limits
    if (subscription.plan === 'enterprise' && subscription.metadata) {
      const metadata = JSON.parse(subscription.metadata)
      if (metadata.perSeatAllowance) {
        minimumLimit = metadata.perSeatAllowance
      }
    }

    if (newLimit < minimumLimit) {
      throw new Error(`Usage limit cannot be below ${minimumLimit} for ${subscription.plan} plan`)
    }

    // Update the member's usage limit
    await db
      .update(schema.userStats)
      .set({
        currentUsageLimit: newLimit.toString(),
        usageLimitSetBy: adminUserId,
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(schema.userStats.userId, memberId))

    logger.info('Updated member usage limit', {
      organizationId,
      memberId,
      newLimit,
      adminUserId,
    })
  } catch (error) {
    logger.error('Failed to update member usage limit', {
      organizationId,
      memberId,
      newLimit,
      adminUserId,
      error,
    })
    throw error
  }
}

/**
 * Get organization billing summary for admin dashboard
 */
export async function getOrganizationBillingSummary(organizationId: string) {
  try {
    const billingData = await getOrganizationBillingData(organizationId)

    if (!billingData) {
      return null
    }

    // Calculate additional metrics
    const membersOverLimit = billingData.members.filter((m) => m.isOverLimit).length
    const membersNearLimit = billingData.members.filter(
      (m) => !m.isOverLimit && m.percentUsed >= 80
    ).length

    const topUsers = billingData.members.slice(0, 5).map((m) => ({
      name: m.userName,
      usage: m.currentUsage,
      limit: m.usageLimit,
      percentUsed: m.percentUsed,
    }))

    return {
      organization: {
        id: billingData.organizationId,
        name: billingData.organizationName,
        plan: billingData.subscriptionPlan,
        status: billingData.subscriptionStatus,
      },
      usage: {
        total: billingData.totalCurrentUsage,
        limit: billingData.totalUsageLimit,
        average: billingData.averageUsagePerMember,
        percentUsed:
          billingData.totalUsageLimit > 0
            ? (billingData.totalCurrentUsage / billingData.totalUsageLimit) * 100
            : 0,
      },
      seats: {
        total: billingData.totalSeats,
        used: billingData.usedSeats,
        available: billingData.totalSeats - billingData.usedSeats,
      },
      alerts: {
        membersOverLimit,
        membersNearLimit,
      },
      billingPeriod: {
        start: billingData.billingPeriodStart,
        end: billingData.billingPeriodEnd,
      },
      topUsers,
    }
  } catch (error) {
    logger.error('Failed to get organization billing summary', { organizationId, error })
    throw error
  }
}
