import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, organization, subscription, user } from '@/db/schema'
import { resetOrganizationBillingPeriod, resetUserBillingPeriod } from './billing-periods'
import { getHighestPrioritySubscription } from './subscription'
import { getUserUsageData } from './usage'

const logger = createLogger('SimplifiedBilling')

// Initialize Stripe client
const stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
})

interface BillingResult {
  success: boolean
  chargedAmount?: number
  invoiceId?: string
  error?: string
}

/**
 * SIMPLIFIED BILLING MODEL:
 * 1. User purchases $20 Pro plan → Gets charged $20 immediately via Stripe subscription
 * 2. User uses $15 during the month → No additional charge (covered by $20)
 * 3. User uses $35 during the month → Gets charged $15 overage at month end
 * 4. Usage resets, next month they pay $20 again + any overages
 */

/**
 * Get plan pricing information
 */
function getPlanPricing(
  plan: string,
  subscription?: any
): {
  basePrice: number // What they pay upfront via Stripe subscription
  minimum: number // Minimum they're guaranteed to pay
} {
  switch (plan) {
    case 'free':
      return { basePrice: 0, minimum: 0 } // Free plan has no charges
    case 'pro':
      return { basePrice: 20, minimum: 20 } // $20/month subscription
    case 'team':
      return { basePrice: 40, minimum: 40 } // $40/seat/month subscription
    case 'enterprise':
      // Get per-seat pricing from metadata
      if (subscription?.metadata) {
        const metadata =
          typeof subscription.metadata === 'string'
            ? JSON.parse(subscription.metadata)
            : subscription.metadata

        const perSeatPrice = metadata.perSeatAllowance || 100
        return { basePrice: perSeatPrice, minimum: perSeatPrice }
      }
      return { basePrice: 100, minimum: 100 } // Default enterprise pricing
    default:
      return { basePrice: 0, minimum: 0 }
  }
}

/**
 * Get Stripe customer ID for a user or organization
 */
async function getStripeCustomerId(referenceId: string): Promise<string | null> {
  try {
    // First check if it's a user
    const userRecord = await db
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, referenceId))
      .limit(1)

    if (userRecord.length > 0 && userRecord[0].stripeCustomerId) {
      return userRecord[0].stripeCustomerId
    }

    // Check if it's an organization
    const orgRecord = await db
      .select({ metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, referenceId))
      .limit(1)

    if (orgRecord.length > 0 && orgRecord[0].metadata) {
      const metadata =
        typeof orgRecord[0].metadata === 'string'
          ? JSON.parse(orgRecord[0].metadata)
          : orgRecord[0].metadata

      if (metadata?.stripeCustomerId) {
        return metadata.stripeCustomerId
      }
    }

    return null
  } catch (error) {
    logger.error('Failed to get Stripe customer ID', { referenceId, error })
    return null
  }
}

/**
 * Create a Stripe invoice for overage billing only
 */
export async function createOverageBillingInvoice(
  customerId: string,
  overageAmount: number,
  description: string,
  metadata: Record<string, string> = {}
): Promise<BillingResult> {
  try {
    if (overageAmount <= 0) {
      logger.info('No overage to bill', { customerId, overageAmount })
      return { success: true, chargedAmount: 0 }
    }

    // Create invoice item for overage only
    const invoiceItem = await stripeClient.invoiceItems.create({
      customer: customerId,
      amount: Math.round(overageAmount * 100), // Convert to cents
      currency: 'usd',
      description,
      metadata: {
        type: 'overage_billing',
        ...metadata,
      },
    })

    logger.info('Created overage invoice item', {
      customerId,
      amount: overageAmount,
      invoiceItemId: invoiceItem.id,
    })

    // Create and finalize invoice
    const invoice = await stripeClient.invoices.create({
      customer: customerId,
      auto_advance: true, // Automatically finalize and attempt payment
      metadata: {
        type: 'overage_billing',
        ...metadata,
      },
    })

    logger.info('Created overage invoice', {
      customerId,
      invoiceId: invoice.id,
      amount: overageAmount,
    })

    // Finalize the invoice to trigger payment
    await stripeClient.invoices.finalizeInvoice(invoice.id)

    logger.info('Finalized overage invoice', {
      customerId,
      invoiceId: invoice.id,
      chargedAmount: overageAmount,
      description,
    })

    return {
      success: true,
      chargedAmount: overageAmount,
      invoiceId: invoice.id,
    }
  } catch (error) {
    logger.error('Failed to create overage billing invoice', {
      customerId,
      overageAmount,
      description,
      error,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

/**
 * Calculate overage billing for a user
 * Returns only the amount that exceeds their subscription base price
 */
export async function calculateUserOverage(userId: string): Promise<{
  basePrice: number
  actualUsage: number
  overageAmount: number
  plan: string
} | null> {
  try {
    // Get user's subscription and usage data
    const [subscription, usageData, userRecord] = await Promise.all([
      getHighestPrioritySubscription(userId),
      getUserUsageData(userId),
      db.select().from(user).where(eq(user.id, userId)).limit(1),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for overage calculation', { userId })
      return null
    }

    const plan = subscription?.plan || 'free'
    const { basePrice } = getPlanPricing(plan, subscription)
    const actualUsage = usageData.currentUsage

    // Calculate overage: any usage beyond what they already paid for
    const overageAmount = Math.max(0, actualUsage - basePrice)

    return {
      basePrice,
      actualUsage,
      overageAmount,
      plan,
    }
  } catch (error) {
    logger.error('Failed to calculate user overage', { userId, error })
    return null
  }
}

/**
 * Process overage billing for an individual user
 */
export async function processUserOverageBilling(userId: string): Promise<BillingResult> {
  try {
    const overageInfo = await calculateUserOverage(userId)

    if (!overageInfo) {
      return { success: false, error: 'Failed to calculate overage information' }
    }

    // Skip billing for free plan users
    if (overageInfo.plan === 'free') {
      logger.info('Skipping overage billing for free plan user', { userId })
      return { success: true, chargedAmount: 0 }
    }

    // Skip if no overage
    if (overageInfo.overageAmount <= 0) {
      logger.info('No overage to bill for user', {
        userId,
        basePrice: overageInfo.basePrice,
        actualUsage: overageInfo.actualUsage,
      })

      // Still reset billing period even if no overage
      try {
        await resetUserBillingPeriod(userId)
      } catch (resetError) {
        logger.error('Failed to reset billing period', { userId, error: resetError })
      }

      return { success: true, chargedAmount: 0 }
    }

    // Get Stripe customer ID
    const stripeCustomerId = await getStripeCustomerId(userId)
    if (!stripeCustomerId) {
      logger.error('No Stripe customer ID found for user', { userId })
      return { success: false, error: 'No Stripe customer ID found' }
    }

    const description = `Usage overage for ${overageInfo.plan} plan - $${overageInfo.overageAmount.toFixed(2)} above $${overageInfo.basePrice} base`
    const metadata = {
      userId,
      plan: overageInfo.plan,
      basePrice: overageInfo.basePrice.toString(),
      actualUsage: overageInfo.actualUsage.toString(),
      overageAmount: overageInfo.overageAmount.toString(),
      billingPeriod: new Date().toISOString().slice(0, 7), // YYYY-MM format
    }

    const result = await createOverageBillingInvoice(
      stripeCustomerId,
      overageInfo.overageAmount,
      description,
      metadata
    )

    // If billing was successful, reset the user's billing period
    if (result.success) {
      try {
        await resetUserBillingPeriod(userId)
        logger.info('Successfully reset billing period after charging user overage', { userId })
      } catch (resetError) {
        logger.error('Failed to reset billing period after successful overage charge', {
          userId,
          error: resetError,
        })
      }
    }

    return result
  } catch (error) {
    logger.error('Failed to process user overage billing', { userId, error })
    return { success: false, error: 'Failed to process overage billing' }
  }
}

/**
 * Process overage billing for an organization (team/enterprise plans)
 */
export async function processOrganizationOverageBilling(
  organizationId: string
): Promise<BillingResult> {
  try {
    // Get organization subscription
    const subscription = await getHighestPrioritySubscription(organizationId)

    if (!subscription || !['team', 'enterprise'].includes(subscription.plan)) {
      logger.warn('No team/enterprise subscription found for organization', { organizationId })
      return { success: false, error: 'No valid subscription found' }
    }

    // Get organization's Stripe customer ID
    const stripeCustomerId = await getStripeCustomerId(organizationId)
    if (!stripeCustomerId) {
      logger.error('No Stripe customer ID found for organization', { organizationId })
      return { success: false, error: 'No Stripe customer ID found' }
    }

    // Get all organization members
    const members = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId))

    if (members.length === 0) {
      logger.info('No members found for organization overage billing', { organizationId })
      return { success: true, chargedAmount: 0 }
    }

    // Calculate total overage for all members
    let totalOverage = 0
    const { basePrice: basePricePerSeat } = getPlanPricing(subscription.plan, subscription)

    const memberOverageDetails = []

    for (const memberInfo of members) {
      const usageData = await getUserUsageData(memberInfo.userId)
      const memberOverage = Math.max(0, usageData.currentUsage - basePricePerSeat)

      totalOverage += memberOverage

      memberOverageDetails.push({
        userId: memberInfo.userId,
        name: memberInfo.userName,
        email: memberInfo.userEmail,
        usage: usageData.currentUsage,
        basePrice: basePricePerSeat,
        overage: memberOverage,
      })
    }

    // Skip if no overage across the organization
    if (totalOverage <= 0) {
      logger.info('No overage to bill for organization', {
        organizationId,
        memberCount: members.length,
        basePricePerSeat,
      })

      // Still reset billing period for all members
      try {
        await resetOrganizationBillingPeriod(organizationId)
      } catch (resetError) {
        logger.error('Failed to reset organization billing period', {
          organizationId,
          error: resetError,
        })
      }

      return { success: true, chargedAmount: 0 }
    }

    // Create consolidated overage invoice for the organization
    const description = `Team usage overage for ${subscription.plan} plan - ${members.length} seats, $${totalOverage.toFixed(2)} total overage`
    const metadata = {
      organizationId,
      plan: subscription.plan,
      memberCount: members.length.toString(),
      basePricePerSeat: basePricePerSeat.toString(),
      totalOverage: totalOverage.toString(),
      billingPeriod: new Date().toISOString().slice(0, 7), // YYYY-MM format
      memberDetails: JSON.stringify(memberOverageDetails),
    }

    const result = await createOverageBillingInvoice(
      stripeCustomerId,
      totalOverage,
      description,
      metadata
    )

    // If billing was successful, reset billing period for all organization members
    if (result.success) {
      try {
        await resetOrganizationBillingPeriod(organizationId)
        logger.info('Successfully reset billing period for organization after overage billing', {
          organizationId,
          memberCount: members.length,
        })
      } catch (resetError) {
        logger.error(
          'Failed to reset organization billing period after successful overage charge',
          {
            organizationId,
            error: resetError,
          }
        )
      }
    }

    logger.info('Processed organization overage billing', {
      organizationId,
      memberCount: members.length,
      totalOverage,
      result,
    })

    return result
  } catch (error) {
    logger.error('Failed to process organization overage billing', { organizationId, error })
    return { success: false, error: 'Failed to process organization overage billing' }
  }
}

/**
 * Get all users and organizations that need overage billing
 */
export async function getUsersAndOrganizationsForOverageBilling(): Promise<{
  users: string[]
  organizations: string[]
}> {
  try {
    // Get all active subscriptions (excluding free plans)
    const activeSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.status, 'active'))

    const users: string[] = []
    const organizations: string[] = []

    for (const sub of activeSubscriptions) {
      if (sub.plan === 'free') {
        continue // Skip free plans
      }

      // Check if referenceId is a user or organization
      const userExists = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, sub.referenceId))
        .limit(1)

      if (userExists.length > 0) {
        // It's a user subscription (pro plan)
        users.push(sub.referenceId)
      } else {
        // Check if it's an organization
        const orgExists = await db
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, sub.referenceId))
          .limit(1)

        if (orgExists.length > 0) {
          // It's an organization subscription (team/enterprise)
          organizations.push(sub.referenceId)
        }
      }
    }

    logger.info('Found entities for overage billing', {
      userCount: users.length,
      organizationCount: organizations.length,
    })

    return { users, organizations }
  } catch (error) {
    logger.error('Failed to get entities for overage billing', { error })
    return { users: [], organizations: [] }
  }
}

/**
 * Get comprehensive billing and subscription summary
 */
export async function getSimplifiedBillingSummary(
  userId: string,
  organizationId?: string
): Promise<{
  type: 'individual' | 'organization'
  plan: string
  basePrice: number
  currentUsage: number
  overageAmount: number
  totalProjected: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  // Subscription details
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  status: string | null
  seats: number | null
  metadata: any
  // Usage details
  usage: {
    current: number
    limit: number
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
    lastPeriodCost: number
    daysRemaining: number
  }
  organizationData?: {
    seatCount: number
    totalBasePrice: number
    totalCurrentUsage: number
    totalOverage: number
  }
}> {
  try {
    // Get subscription and usage data upfront
    const [subscription, usageData] = await Promise.all([
      getHighestPrioritySubscription(organizationId || userId),
      getUserUsageData(userId),
    ])

    // Determine subscription type flags
    const plan = subscription?.plan || 'free'
    const isPaid = plan !== 'free'
    const isPro = plan === 'pro'
    const isTeam = plan === 'team'
    const isEnterprise = plan === 'enterprise'

    if (organizationId) {
      // Organization billing summary
      if (!subscription) {
        return getDefaultBillingSummary('organization')
      }

      // Get all organization members
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      const { basePrice: basePricePerSeat } = getPlanPricing(subscription.plan, subscription)
      const seatCount = members.length
      const totalBasePrice = basePricePerSeat * seatCount

      let totalCurrentUsage = 0
      let totalOverage = 0

      // Calculate totals across all members
      for (const memberInfo of members) {
        const memberUsageData = await getUserUsageData(memberInfo.userId)
        totalCurrentUsage += memberUsageData.currentUsage
        totalOverage += Math.max(0, memberUsageData.currentUsage - basePricePerSeat)
      }

      // Get user's personal limits for warnings
      const percentUsed =
        usageData.limit > 0 ? Math.round((usageData.currentUsage / usageData.limit) * 100) : 0

      // Calculate days remaining in billing period
      const daysRemaining = usageData.billingPeriodEnd
        ? Math.max(
            0,
            Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          )
        : 0

      return {
        type: 'organization',
        plan: subscription.plan,
        basePrice: totalBasePrice,
        currentUsage: totalCurrentUsage,
        overageAmount: totalOverage,
        totalProjected: totalBasePrice + totalOverage,
        usageLimit: usageData.limit,
        percentUsed,
        isWarning: percentUsed >= 80 && percentUsed < 100,
        isExceeded: usageData.currentUsage >= usageData.limit,
        daysRemaining,
        // Subscription details
        isPaid,
        isPro,
        isTeam,
        isEnterprise,
        status: subscription.status || null,
        seats: subscription.seats || null,
        metadata: subscription.metadata || null,
        // Usage details
        usage: {
          current: usageData.currentUsage,
          limit: usageData.limit,
          percentUsed,
          isWarning: percentUsed >= 80 && percentUsed < 100,
          isExceeded: usageData.currentUsage >= usageData.limit,
          billingPeriodStart: usageData.billingPeriodStart,
          billingPeriodEnd: usageData.billingPeriodEnd,
          lastPeriodCost: usageData.lastPeriodCost,
          daysRemaining,
        },
        organizationData: {
          seatCount,
          totalBasePrice,
          totalCurrentUsage,
          totalOverage,
        },
      }
    }

    // Individual billing summary
    const { basePrice } = getPlanPricing(plan, subscription)
    const overageAmount = Math.max(0, usageData.currentUsage - basePrice)
    const percentUsed =
      usageData.limit > 0 ? Math.round((usageData.currentUsage / usageData.limit) * 100) : 0

    // Calculate days remaining in billing period
    const daysRemaining = usageData.billingPeriodEnd
      ? Math.max(
          0,
          Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0

    return {
      type: 'individual',
      plan,
      basePrice,
      currentUsage: usageData.currentUsage,
      overageAmount,
      totalProjected: basePrice + overageAmount,
      usageLimit: usageData.limit,
      percentUsed,
      isWarning: percentUsed >= 80 && percentUsed < 100,
      isExceeded: usageData.currentUsage >= usageData.limit,
      daysRemaining,
      // Subscription details
      isPaid,
      isPro,
      isTeam,
      isEnterprise,
      status: subscription?.status || null,
      seats: subscription?.seats || null,
      metadata: subscription?.metadata || null,
      // Usage details
      usage: {
        current: usageData.currentUsage,
        limit: usageData.limit,
        percentUsed,
        isWarning: percentUsed >= 80 && percentUsed < 100,
        isExceeded: usageData.currentUsage >= usageData.limit,
        billingPeriodStart: usageData.billingPeriodStart,
        billingPeriodEnd: usageData.billingPeriodEnd,
        lastPeriodCost: usageData.lastPeriodCost,
        daysRemaining,
      },
    }
  } catch (error) {
    logger.error('Failed to get simplified billing summary', { userId, organizationId, error })
    return getDefaultBillingSummary(organizationId ? 'organization' : 'individual')
  }
}

/**
 * Get default billing summary for error cases
 */
function getDefaultBillingSummary(type: 'individual' | 'organization') {
  return {
    type,
    plan: 'free',
    basePrice: 0,
    currentUsage: 0,
    overageAmount: 0,
    totalProjected: 0,
    usageLimit: 5,
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    daysRemaining: 0,
    // Subscription details
    isPaid: false,
    isPro: false,
    isTeam: false,
    isEnterprise: false,
    status: null,
    seats: null,
    metadata: null,
    // Usage details
    usage: {
      current: 0,
      limit: 5,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
      daysRemaining: 0,
    },
  }
}

/**
 * Process monthly overage billing for all users and organizations
 */
export async function processMonthlyOverageBilling(): Promise<{
  success: boolean
  processedUsers: number
  processedOrganizations: number
  totalChargedAmount: number
  errors: string[]
}> {
  try {
    logger.info('Starting monthly overage billing process')

    const { users, organizations } = await getUsersAndOrganizationsForOverageBilling()

    let processedUsers = 0
    let processedOrganizations = 0
    let totalChargedAmount = 0
    const errors: string[] = []

    // Process individual users (pro plans)
    for (const userId of users) {
      try {
        const result = await processUserOverageBilling(userId)
        if (result.success) {
          processedUsers++
          totalChargedAmount += result.chargedAmount || 0
          logger.info('Successfully processed user overage billing', {
            userId,
            chargedAmount: result.chargedAmount,
          })
        } else {
          errors.push(`User ${userId}: ${result.error}`)
          logger.error('Failed to process user overage billing', { userId, error: result.error })
        }
      } catch (error) {
        const errorMsg = `User ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        errors.push(errorMsg)
        logger.error('Exception during user overage billing', { userId, error })
      }
    }

    // Process organizations (team/enterprise plans)
    for (const organizationId of organizations) {
      try {
        const result = await processOrganizationOverageBilling(organizationId)
        if (result.success) {
          processedOrganizations++
          totalChargedAmount += result.chargedAmount || 0
          logger.info('Successfully processed organization overage billing', {
            organizationId,
            chargedAmount: result.chargedAmount,
          })
        } else {
          errors.push(`Organization ${organizationId}: ${result.error}`)
          logger.error('Failed to process organization overage billing', {
            organizationId,
            error: result.error,
          })
        }
      } catch (error) {
        const errorMsg = `Organization ${organizationId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        errors.push(errorMsg)
        logger.error('Exception during organization overage billing', { organizationId, error })
      }
    }

    logger.info('Completed monthly overage billing process', {
      processedUsers,
      processedOrganizations,
      totalChargedAmount,
      errorCount: errors.length,
    })

    return {
      success: errors.length === 0,
      processedUsers,
      processedOrganizations,
      totalChargedAmount,
      errors,
    }
  } catch (error) {
    logger.error('Fatal error during monthly overage billing process', { error })
    return {
      success: false,
      processedUsers: 0,
      processedOrganizations: 0,
      totalChargedAmount: 0,
      errors: [error instanceof Error ? error.message : 'Fatal overage billing process error'],
    }
  }
}
