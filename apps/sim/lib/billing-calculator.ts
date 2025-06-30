import { eq } from 'drizzle-orm'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { createLogger } from './logs/console-logger'
import { getHighestPrioritySubscription } from './subscription/subscription'
import { calculateDefaultUsageLimit } from './subscription/utils'

const logger = createLogger('BillingCalculator')

interface BillingPeriod {
  start: Date
  end: Date
}

interface UserBillingData {
  userId: string
  userName: string
  userEmail: string
  currentUsageLimit: number
  actualUsage: number
  defaultPlanLimit: number
  subscriptionPlan: string
  chargeableAmount: number
  isOverage: boolean
}

interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  totalChargeableAmount: number
  members: UserBillingData[]
}

/**
 * Calculate billing charges for a specific user during a billing period
 * Users are charged based on their custom usage limit, not their actual consumption
 */
export async function calculateUserBilling(
  userId: string,
  period: BillingPeriod
): Promise<UserBillingData | null> {
  try {
    // Get user info and current usage stats
    const [userRecord, userStatsRecord] = await Promise.all([
      db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1),
      db.select().from(schema.userStats).where(eq(schema.userStats.userId, userId)).limit(1),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for billing calculation', { userId })
      return null
    }

    const user = userRecord[0]
    const userStats = userStatsRecord[0]

    if (!userStats) {
      logger.info('No usage stats found for user', { userId })
      return {
        userId,
        userName: user.name,
        userEmail: user.email,
        currentUsageLimit: 5, // Default free tier
        actualUsage: 0,
        defaultPlanLimit: 5,
        subscriptionPlan: 'free',
        chargeableAmount: 5, // Charge minimum for free tier
        isOverage: false,
      }
    }

    // Get subscription info
    const subscription = await getHighestPrioritySubscription(userId)
    const defaultPlanLimit = calculateDefaultUsageLimit(subscription)
    const plan = subscription?.plan || 'free'

    // Current usage limit is what the user has set
    const currentUsageLimit = Number.parseFloat(userStats.currentUsageLimit)
    const actualUsage = Number.parseFloat(userStats.totalCost)

    // Billing logic based on plan:
    let chargeableAmount = 0
    let isOverage = false

    if (plan === 'free') {
      // Free plan: always charge the base $5, regardless of usage
      chargeableAmount = 5
    } else {
      // Paid plans: charge based on the custom limit they've set
      // This is the key insight - we charge for the limit, not the usage
      chargeableAmount = currentUsageLimit
      isOverage = currentUsageLimit > defaultPlanLimit
    }

    return {
      userId,
      userName: user.name,
      userEmail: user.email,
      currentUsageLimit,
      actualUsage,
      defaultPlanLimit,
      subscriptionPlan: plan,
      chargeableAmount,
      isOverage,
    }
  } catch (error) {
    logger.error('Failed to calculate user billing', { userId, error })
    return null
  }
}

/**
 * Calculate billing for all members of an organization
 */
export async function calculateOrganizationBilling(
  organizationId: string,
  period: BillingPeriod
): Promise<OrganizationBillingData | null> {
  try {
    // Get organization info
    const orgRecord = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      logger.warn('Organization not found for billing calculation', { organizationId })
      return null
    }

    const organization = orgRecord[0]

    // Get all members of the organization
    const members = await db
      .select({
        userId: schema.member.userId,
      })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId))

    if (members.length === 0) {
      logger.info('No members found for organization', { organizationId })
      return {
        organizationId,
        organizationName: organization.name,
        subscriptionPlan: 'team',
        totalChargeableAmount: 0,
        members: [],
      }
    }

    // Calculate billing for each member
    const memberBillingPromises = members.map((member) =>
      calculateUserBilling(member.userId, period)
    )

    const memberBillingResults = await Promise.all(memberBillingPromises)
    const validMemberBilling = memberBillingResults.filter(
      (result): result is UserBillingData => result !== null
    )

    // Calculate total
    const totalChargeableAmount = validMemberBilling.reduce(
      (total, member) => total + member.chargeableAmount,
      0
    )

    // Get organization subscription plan
    const orgSubscription = await getHighestPrioritySubscription(
      members[0]?.userId, // Use first member to get org subscription
      organizationId
    )

    return {
      organizationId,
      organizationName: organization.name,
      subscriptionPlan: orgSubscription?.plan || 'team',
      totalChargeableAmount,
      members: validMemberBilling,
    }
  } catch (error) {
    logger.error('Failed to calculate organization billing', { organizationId, error })
    return null
  }
}

/**
 * Generate billing report for all users and organizations
 * This would typically be run monthly
 */
export async function generateBillingReport(period: BillingPeriod): Promise<{
  individualUsers: UserBillingData[]
  organizations: OrganizationBillingData[]
  totalRevenue: number
}> {
  try {
    logger.info('Generating billing report', { period })

    // Get all individual users (not part of any organization with active team subscription)
    const allUsers = await db.select().from(schema.user)
    const allOrganizations = await db.select().from(schema.organization)

    // Calculate individual user billing
    const individualUserPromises = allUsers.map((user) => calculateUserBilling(user.id, period))
    const individualUserResults = await Promise.all(individualUserPromises)
    const validIndividualUsers = individualUserResults.filter(
      (result): result is UserBillingData => result !== null
    )

    // Calculate organization billing
    const organizationPromises = allOrganizations.map((org) =>
      calculateOrganizationBilling(org.id, period)
    )
    const organizationResults = await Promise.all(organizationPromises)
    const validOrganizations = organizationResults.filter(
      (result): result is OrganizationBillingData => result !== null
    )

    // Calculate total revenue
    const individualRevenue = validIndividualUsers.reduce(
      (total, user) => total + user.chargeableAmount,
      0
    )
    const organizationRevenue = validOrganizations.reduce(
      (total, org) => total + org.totalChargeableAmount,
      0
    )
    const totalRevenue = individualRevenue + organizationRevenue

    logger.info('Billing report generated', {
      individualUsers: validIndividualUsers.length,
      organizations: validOrganizations.length,
      totalRevenue,
    })

    return {
      individualUsers: validIndividualUsers,
      organizations: validOrganizations,
      totalRevenue,
    }
  } catch (error) {
    logger.error('Failed to generate billing report', { error })
    throw error
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
 * Get previous billing period
 */
export function getPreviousBillingPeriod(): BillingPeriod {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  return { start, end }
}
