import { eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, organization, user, userStats } from '@/db/schema'

const logger = createLogger('BillingCalculator')

interface BillingPeriod {
  start: Date
  end: Date
}

interface UserBillingData {
  userId: string
  userName: string
  userEmail: string
  actualUsage: number
  planMinimum: number
  subscriptionPlan: string
  chargeableAmount: number
  isOverMinimum: boolean
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
}

interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  totalChargeableAmount: number
  members: UserBillingData[]
  seatCount: number
  minimumSeatCharge: number
  totalUsageCharge: number
  averageUsagePerSeat: number
}

/**
 * Calculate billing data for a specific user
 * New logic: Show plan minimum + actual usage, limits are for user control only
 */
export async function calculateUserBillingData(userId: string): Promise<UserBillingData | null> {
  try {
    // Get user info and current usage stats
    const [userRecord, userStatsRecord] = await Promise.all([
      db.select().from(user).where(eq(user.id, userId)).limit(1),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for billing calculation', { userId })
      return null
    }

    const userRecord0 = userRecord[0]
    const userStatsRecord0 = userStatsRecord[0]

    if (!userStatsRecord0) {
      logger.info('No usage stats found for user', { userId })
      return {
        userId,
        userName: userRecord0.name,
        userEmail: userRecord0.email,
        actualUsage: 0,
        planMinimum: 0, // No minimum for free plan
        subscriptionPlan: 'free',
        chargeableAmount: 0, // Never charge free users
        isOverMinimum: false,
        usageLimit: 5,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
      }
    }

    // Get subscription info
    const subscriptionInfo = await getHighestPrioritySubscription(userId)
    const plan = subscriptionInfo?.plan || 'free'

    // Use current period cost for billing calculation
    const actualUsage = Number.parseFloat(userStatsRecord0.currentPeriodCost || '0')
    const usageLimit = Number.parseFloat(userStatsRecord0.currentUsageLimit || '5')

    // Determine plan minimums and calculate charges based on new logic
    let planMinimum = 0
    let chargeableAmount = 0

    switch (plan) {
      case 'free':
        planMinimum = 0 // No minimum for free plan
        chargeableAmount = 0 // Never charge free users
        break

      case 'pro':
        planMinimum = 20
        // Charge $20 minimum + any usage above $20
        chargeableAmount = Math.max(planMinimum, actualUsage)
        break

      case 'team':
        planMinimum = 40
        // Charge $40 minimum + any usage above $40
        chargeableAmount = Math.max(planMinimum, actualUsage)
        break

      case 'enterprise': {
        // For enterprise, get the per-seat allowance from metadata
        const metadata = subscriptionInfo?.metadata ? JSON.parse(subscriptionInfo.metadata) : {}
        planMinimum = metadata.perSeatAllowance || 100
        chargeableAmount = Math.max(planMinimum, actualUsage)
        break
      }

      default:
        planMinimum = 0
        chargeableAmount = 0
    }

    const isOverMinimum = actualUsage > planMinimum
    const percentUsed = usageLimit > 0 ? Math.round((actualUsage / usageLimit) * 100) : 0
    const isWarning = percentUsed >= 80 && percentUsed < 100
    const isExceeded = actualUsage >= usageLimit

    return {
      userId,
      userName: userRecord0.name,
      userEmail: userRecord0.email,
      actualUsage,
      planMinimum,
      subscriptionPlan: plan,
      chargeableAmount,
      isOverMinimum,
      usageLimit,
      percentUsed,
      isWarning,
      isExceeded,
    }
  } catch (error) {
    logger.error('Failed to calculate user billing data', { userId, error })
    return null
  }
}

/**
 * Calculate billing data for all members of an organization
 */
export async function calculateOrganizationBillingData(
  organizationId: string
): Promise<OrganizationBillingData | null> {
  try {
    // Get organization info and subscription
    const [orgRecord, subscriptionInfo] = await Promise.all([
      db.select().from(organization).where(eq(organization.id, organizationId)).limit(1),
      getHighestPrioritySubscription(organizationId),
    ])

    if (orgRecord.length === 0) {
      logger.warn('Organization not found for billing calculation', { organizationId })
      return null
    }

    const organizationRecord = orgRecord[0]
    const plan = subscriptionInfo?.plan || 'team'

    // Get all members of the organization
    const members = await db
      .select({
        userId: member.userId,
      })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    if (members.length === 0) {
      logger.info('No members found for organization', { organizationId })
      return {
        organizationId,
        organizationName: organizationRecord.name,
        subscriptionPlan: plan,
        totalChargeableAmount: 0,
        members: [],
        seatCount: 0,
        minimumSeatCharge: 0,
        totalUsageCharge: 0,
        averageUsagePerSeat: 0,
      }
    }

    // Calculate billing for each member
    const memberBillingPromises = members.map((memberRecord) =>
      calculateUserBillingData(memberRecord.userId)
    )

    const memberBillingResults = await Promise.all(memberBillingPromises)
    const validMemberBilling = memberBillingResults.filter(
      (result): result is UserBillingData => result !== null
    )

    // Determine per-seat minimum based on plan
    let seatMinimum = 0
    switch (plan) {
      case 'team':
        seatMinimum = 40
        break
      case 'enterprise': {
        const metadata = subscriptionInfo?.metadata ? JSON.parse(subscriptionInfo.metadata) : {}
        seatMinimum = metadata.perSeatAllowance || 100
        break
      }
      default:
        seatMinimum = 40 // Default team pricing
    }

    // Calculate organization billing totals
    const seatCount = validMemberBilling.length
    const minimumSeatCharge = seatCount * seatMinimum

    // Calculate total actual usage charge (minimum + overages)
    const totalUsageCharge = validMemberBilling.reduce(
      (total, memberBilling) => total + Math.max(memberBilling.actualUsage, seatMinimum),
      0
    )

    const averageUsagePerSeat = seatCount > 0 ? totalUsageCharge / seatCount : 0

    // Update member billing data with seat information
    const membersWithSeatInfo = validMemberBilling.map((memberBilling) => ({
      ...memberBilling,
      planMinimum: seatMinimum,
      chargeableAmount: Math.max(memberBilling.actualUsage, seatMinimum),
    }))

    return {
      organizationId,
      organizationName: organizationRecord.name,
      subscriptionPlan: plan,
      totalChargeableAmount: totalUsageCharge,
      members: membersWithSeatInfo,
      seatCount,
      minimumSeatCharge,
      totalUsageCharge,
      averageUsagePerSeat,
    }
  } catch (error) {
    logger.error('Failed to calculate organization billing data', { organizationId, error })
    return null
  }
}

/**
 * Calculate upcoming billing charge for a user (for display in UI)
 */
export async function getUpcomingUserBilling(userId: string): Promise<{
  currentUsage: number
  planMinimum: number
  projectedCharge: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  plan: string
  daysRemaining: number
}> {
  try {
    const billingData = await calculateUserBillingData(userId)

    if (!billingData) {
      return {
        currentUsage: 0,
        planMinimum: 0,
        projectedCharge: 0,
        usageLimit: 5,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        plan: 'free',
        daysRemaining: 0,
      }
    }

    // Get billing period info
    const userStatsRecord = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    let daysRemaining = 0
    if (userStatsRecord.length > 0 && userStatsRecord[0].billingPeriodEnd) {
      const now = new Date()
      const periodEnd = userStatsRecord[0].billingPeriodEnd
      const diffTime = periodEnd.getTime() - now.getTime()
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
    }

    return {
      currentUsage: billingData.actualUsage,
      planMinimum: billingData.planMinimum,
      projectedCharge: billingData.chargeableAmount,
      usageLimit: billingData.usageLimit,
      percentUsed: billingData.percentUsed,
      isWarning: billingData.isWarning,
      isExceeded: billingData.isExceeded,
      plan: billingData.subscriptionPlan,
      daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to get upcoming user billing', { userId, error })
    return {
      currentUsage: 0,
      planMinimum: 0,
      projectedCharge: 0,
      usageLimit: 5,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      plan: 'free',
      daysRemaining: 0,
    }
  }
}

/**
 * Calculate upcoming billing charge for an organization (for display in UI)
 */
export async function getUpcomingOrganizationBilling(organizationId: string): Promise<{
  totalCurrentUsage: number
  minimumSeatCharge: number
  projectedCharge: number
  seatCount: number
  averageUsagePerSeat: number
  plan: string
  members: Array<{
    userId: string
    name: string
    usage: number
    minimum: number
    projected: number
    percentUsed: number
    isOverMinimum: boolean
  }>
}> {
  try {
    const billingData = await calculateOrganizationBillingData(organizationId)

    if (!billingData) {
      return {
        totalCurrentUsage: 0,
        minimumSeatCharge: 0,
        projectedCharge: 0,
        seatCount: 0,
        averageUsagePerSeat: 0,
        plan: 'team',
        members: [],
      }
    }

    const membersWithDetails = billingData.members.map((memberBilling) => ({
      userId: memberBilling.userId,
      name: memberBilling.userName,
      usage: memberBilling.actualUsage,
      minimum: memberBilling.planMinimum,
      projected: memberBilling.chargeableAmount,
      percentUsed: memberBilling.percentUsed,
      isOverMinimum: memberBilling.isOverMinimum,
    }))

    return {
      totalCurrentUsage: billingData.members.reduce((sum, m) => sum + m.actualUsage, 0),
      minimumSeatCharge: billingData.minimumSeatCharge,
      projectedCharge: billingData.totalChargeableAmount,
      seatCount: billingData.seatCount,
      averageUsagePerSeat: billingData.averageUsagePerSeat,
      plan: billingData.subscriptionPlan,
      members: membersWithDetails,
    }
  } catch (error) {
    logger.error('Failed to get upcoming organization billing', { organizationId, error })
    return {
      totalCurrentUsage: 0,
      minimumSeatCharge: 0,
      projectedCharge: 0,
      seatCount: 0,
      averageUsagePerSeat: 0,
      plan: 'team',
      members: [],
    }
  }
}

/**
 * Get current billing period (monthly)
 */
export function getCurrentBillingPeriod(): BillingPeriod {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1) // First day of month
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) // Last day of month

  return { start, end }
}

/**
 * Get billing summary for display in subscription modal
 */
export async function getBillingSummary(
  userId: string,
  organizationId?: string
): Promise<{
  type: 'individual' | 'organization'
  plan: string
  currentUsage: number
  planMinimum: number
  projectedCharge: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  organizationData?: {
    seatCount: number
    averageUsagePerSeat: number
    totalMinimum: number
  }
}> {
  try {
    if (organizationId) {
      // Organization billing
      const [orgBilling, userBilling] = await Promise.all([
        getUpcomingOrganizationBilling(organizationId),
        getUpcomingUserBilling(userId),
      ])

      return {
        type: 'organization',
        plan: orgBilling.plan,
        currentUsage: orgBilling.totalCurrentUsage,
        planMinimum: orgBilling.minimumSeatCharge,
        projectedCharge: orgBilling.projectedCharge,
        usageLimit: userBilling.usageLimit * orgBilling.seatCount, // Total org limit
        percentUsed: Math.round(
          (orgBilling.totalCurrentUsage / (userBilling.usageLimit * orgBilling.seatCount)) * 100
        ),
        isWarning: false, // Organizations use individual member warnings
        isExceeded: false, // Organizations use individual member limits
        daysRemaining: userBilling.daysRemaining,
        organizationData: {
          seatCount: orgBilling.seatCount,
          averageUsagePerSeat: orgBilling.averageUsagePerSeat,
          totalMinimum: orgBilling.minimumSeatCharge,
        },
      }
    }
    // Individual billing
    const userBilling = await getUpcomingUserBilling(userId)

    return {
      type: 'individual',
      plan: userBilling.plan,
      currentUsage: userBilling.currentUsage,
      planMinimum: userBilling.planMinimum,
      projectedCharge: userBilling.projectedCharge,
      usageLimit: userBilling.usageLimit,
      percentUsed: userBilling.percentUsed,
      isWarning: userBilling.isWarning,
      isExceeded: userBilling.isExceeded,
      daysRemaining: userBilling.daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to get billing summary', { userId, organizationId, error })
    return {
      type: 'individual',
      plan: 'free',
      currentUsage: 0,
      planMinimum: 0,
      projectedCharge: 0,
      usageLimit: 5,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      daysRemaining: 0,
    }
  }
}
