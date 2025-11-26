import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type {
  CreditBalanceInfo,
  CreditDeductionResult,
  CreditDepletionBehavior,
} from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CreditDeduction')

/**
 * Attempts to deduct prepaid credits for a workflow execution cost.
 * Follows the credit hierarchy: User credits (if Pro in team) → Organization credits → Overage billing
 *
 * @param userId - The user executing the workflow
 * @param cost - The dollar cost of the execution
 * @param workflowId - The workflow ID for logging
 * @returns Result indicating how much was covered by credits and how much remains
 */
export async function tryDeductPrepaidCredits({
  userId,
  cost,
  workflowId,
}: {
  userId: string
  cost: number
  workflowId: string
}): Promise<CreditDeductionResult> {
  try {
    // Get user's subscription to determine billing entity
    const subscription = await getHighestPrioritySubscription(userId)

    if (!subscription) {
      return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
    }

    // Team/Enterprise: Use organization credits (may also use personal credits first)
    if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
      return await deductTeamCredits({
        organizationId: subscription.referenceId,
        cost,
        userId,
        workflowId,
      })
    }

    // Pro: Use individual user credits only
    if (subscription.plan === 'pro') {
      return await deductUserCredits({ userId, cost, workflowId })
    }

    // Free plan: No prepaid credits available
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  } catch (error) {
    logger.error('Error deducting prepaid credits', { userId, cost, error })
    // Fail gracefully - charge normally if credit deduction fails
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  }
}

/**
 * Deducts credits from a Pro user's balance.
 * Uses atomic SQL operations to prevent race conditions.
 */
async function deductUserCredits({
  userId,
  cost,
  workflowId,
}: {
  userId: string
  cost: number
  workflowId: string
}): Promise<CreditDeductionResult> {
  return await deductUserCreditsInternal({ db, userId, cost, workflowId })
}

/**
 * Internal function to deduct user credits - supports both standalone and transactional usage
 */
async function deductUserCreditsInternal({
  db: dbClient,
  userId,
  cost,
  workflowId,
}: {
  db: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
  userId: string
  cost: number
  workflowId: string
}): Promise<CreditDeductionResult> {
  // Update balance atomically using SQL expressions to prevent race conditions
  // The calculation happens entirely in SQL: deduct MIN(cost, current_balance)
  const result = await dbClient
    .update(userStats)
    .set({
      prepaidCreditsBalance: sql`GREATEST(0, prepaid_credits_balance - LEAST(${cost}, prepaid_credits_balance))`,
      prepaidCreditsTotalUsed: sql`prepaid_credits_total_used + LEAST(${cost}, prepaid_credits_balance)`,
    })
    .where(eq(userStats.userId, userId))
    .returning({
      oldBalance: userStats.prepaidCreditsBalance,
    })

  // If no user stats exist, return zero deduction
  if (!result || result.length === 0) {
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  }

  const oldBalance = Number.parseFloat(result[0].oldBalance?.toString() || '0')

  // If balance was already zero, no deduction occurred
  if (oldBalance <= 0) {
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  }

  // Calculate how much was actually deducted (atomically in DB)
  const amountDeducted = Math.min(cost, oldBalance)
  const remainingCost = cost - amountDeducted

  logger.info('Deducted user prepaid credits', {
    userId,
    workflowId,
    cost,
    amountDeducted,
    oldBalance,
    remainingCost,
  })

  return {
    costCoveredByCredits: amountDeducted,
    remainingCost,
    creditsUsed: true,
  }
}

/**
 * Deducts credits for team/enterprise plans.
 * First tries user's personal credits (if they have any from prior Pro subscription),
 * then uses organization credits.
 * Uses a database transaction to ensure atomicity - if org credit deduction fails,
 * user credits are also rolled back to prevent data loss.
 */
async function deductTeamCredits({
  organizationId,
  cost,
  userId,
  workflowId,
}: {
  organizationId: string
  cost: number
  userId: string
  workflowId: string
}): Promise<CreditDeductionResult> {
  // Wrap both deductions in a transaction to prevent partial deduction
  return await db.transaction(async (tx) => {
    let totalCovered = 0
    let remainingCost = cost

    // Step 1: Try user's personal credits first (from previous Pro subscription)
    const userResult = await deductUserCreditsInternal({
      db: tx,
      userId,
      cost: remainingCost,
      workflowId,
    })

    totalCovered += userResult.costCoveredByCredits
    remainingCost = userResult.remainingCost

    if (remainingCost <= 0) {
      // Fully covered by user's personal credits
      return {
        costCoveredByCredits: totalCovered,
        remainingCost: 0,
        creditsUsed: true,
      }
    }

    // Step 2: Use organization credits for remaining cost
    const orgResult = await deductOrganizationCreditsInternal({
      db: tx,
      organizationId,
      cost: remainingCost,
      userId,
      workflowId,
    })

    totalCovered += orgResult.costCoveredByCredits
    remainingCost = orgResult.remainingCost

    return {
      costCoveredByCredits: totalCovered,
      remainingCost,
      creditsUsed: totalCovered > 0,
    }
  })
}

/**
 * Deducts credits from organization balance.
 * Used for team/enterprise plans.
 */
async function deductOrganizationCredits({
  organizationId,
  cost,
  userId,
  workflowId,
}: {
  organizationId: string
  cost: number
  userId: string
  workflowId: string
}): Promise<CreditDeductionResult> {
  return await deductOrganizationCreditsInternal({ db, organizationId, cost, userId, workflowId })
}

/**
 * Internal function to deduct organization credits - supports both standalone and transactional usage
 */
async function deductOrganizationCreditsInternal({
  db: dbClient,
  organizationId,
  cost,
  userId,
  workflowId,
}: {
  db: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
  organizationId: string
  cost: number
  userId: string
  workflowId: string
}): Promise<CreditDeductionResult> {
  // Update organization balance atomically using SQL expressions to prevent race conditions
  // The calculation happens entirely in SQL: deduct MIN(cost, current_balance)
  const result = await dbClient
    .update(organization)
    .set({
      prepaidCreditsBalance: sql`GREATEST(0, prepaid_credits_balance - LEAST(${cost}, prepaid_credits_balance))`,
      prepaidCreditsTotalUsed: sql`prepaid_credits_total_used + LEAST(${cost}, prepaid_credits_balance)`,
    })
    .where(eq(organization.id, organizationId))
    .returning({
      oldBalance: organization.prepaidCreditsBalance,
    })

  // If no organization exists, return zero deduction
  if (!result || result.length === 0) {
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  }

  const oldBalance = Number.parseFloat(result[0].oldBalance?.toString() || '0')

  // If balance was already zero, no deduction occurred
  if (oldBalance <= 0) {
    return { costCoveredByCredits: 0, remainingCost: cost, creditsUsed: false }
  }

  // Calculate how much was actually deducted (atomically in DB)
  const amountDeducted = Math.min(cost, oldBalance)
  const remainingCost = cost - amountDeducted

  logger.info('Deducted organization prepaid credits', {
    organizationId,
    userId,
    workflowId,
    cost,
    amountDeducted,
    oldBalance,
    remainingCost,
  })

  return {
    costCoveredByCredits: amountDeducted,
    remainingCost,
    creditsUsed: true,
  }
}

/**
 * Checks if sufficient prepaid credits are available for execution.
 * Used in pre-execution validation.
 */
export async function hasSufficientCredits({
  userId,
  subscription,
}: {
  userId: string
  subscription: any
}): Promise<CreditBalanceInfo> {
  try {
    if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
      // Check organization credits
      const [org] = await db
        .select({ balance: organization.prepaidCreditsBalance })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      const balance = Number.parseFloat(org?.balance?.toString() || '0')

      // Also check if user has personal credits
      const [stats] = await db
        .select({ balance: userStats.prepaidCreditsBalance })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1)

      const userBalance = Number.parseFloat(stats?.balance?.toString() || '0')

      // Total available = user credits + org credits
      const totalBalance = userBalance + balance

      return { available: totalBalance > 0, balance: totalBalance }
    }

    // Pro plan - check individual user credits
    const [stats] = await db
      .select({ balance: userStats.prepaidCreditsBalance })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const balance = Number.parseFloat(stats?.balance?.toString() || '0')
    return { available: balance > 0, balance }
  } catch (error) {
    logger.error('Error checking credit balance', { userId, error })
    return { available: false, balance: 0 }
  }
}

/**
 * Gets the credit depletion behavior for a user/organization.
 * Determines whether to fallback to overage billing or block execution when credits are depleted.
 */
export async function getCreditDepletionBehavior({
  userId,
  subscription,
}: {
  userId: string
  subscription: any
}): Promise<CreditDepletionBehavior> {
  try {
    if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
      const [org] = await db
        .select({ behavior: organization.creditDepletionBehavior })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      return (org?.behavior as CreditDepletionBehavior) || 'fallback_to_overage'
    }

    // Pro plan
    const [stats] = await db
      .select({ behavior: userStats.creditDepletionBehavior })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    return (stats?.behavior as CreditDepletionBehavior) || 'fallback_to_overage'
  } catch (error) {
    logger.error('Error getting credit depletion behavior', { userId, error })
    return 'fallback_to_overage' // Safe default
  }
}

/**
 * Gets prepaid credits balance for a user or organization.
 * Used for UI display and reporting.
 */
export async function getPrepaidCreditsBalance({
  userId,
  subscription,
}: {
  userId: string
  subscription: any
}): Promise<{
  balance: number
  totalPurchased: number
  totalUsed: number
  lastPurchaseAt: Date | null
  depletionBehavior: CreditDepletionBehavior
}> {
  try {
    if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
      const [org] = await db
        .select({
          balance: organization.prepaidCreditsBalance,
          totalPurchased: organization.prepaidCreditsTotalPurchased,
          totalUsed: organization.prepaidCreditsTotalUsed,
          lastPurchaseAt: organization.prepaidCreditsLastPurchaseAt,
          depletionBehavior: organization.creditDepletionBehavior,
        })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      if (!org) {
        return {
          balance: 0,
          totalPurchased: 0,
          totalUsed: 0,
          lastPurchaseAt: null,
          depletionBehavior: 'fallback_to_overage',
        }
      }

      return {
        balance: Number.parseFloat(org.balance?.toString() || '0'),
        totalPurchased: Number.parseFloat(org.totalPurchased?.toString() || '0'),
        totalUsed: Number.parseFloat(org.totalUsed?.toString() || '0'),
        lastPurchaseAt: org.lastPurchaseAt,
        depletionBehavior:
          (org.depletionBehavior as CreditDepletionBehavior) || 'fallback_to_overage',
      }
    }

    // Pro plan
    const [stats] = await db
      .select({
        balance: userStats.prepaidCreditsBalance,
        totalPurchased: userStats.prepaidCreditsTotalPurchased,
        totalUsed: userStats.prepaidCreditsTotalUsed,
        lastPurchaseAt: userStats.prepaidCreditsLastPurchaseAt,
        depletionBehavior: userStats.creditDepletionBehavior,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (!stats) {
      return {
        balance: 0,
        totalPurchased: 0,
        totalUsed: 0,
        lastPurchaseAt: null,
        depletionBehavior: 'fallback_to_overage',
      }
    }

    return {
      balance: Number.parseFloat(stats.balance?.toString() || '0'),
      totalPurchased: Number.parseFloat(stats.totalPurchased?.toString() || '0'),
      totalUsed: Number.parseFloat(stats.totalUsed?.toString() || '0'),
      lastPurchaseAt: stats.lastPurchaseAt,
      depletionBehavior:
        (stats.depletionBehavior as CreditDepletionBehavior) || 'fallback_to_overage',
    }
  } catch (error) {
    logger.error('Error getting prepaid credits balance', { userId, error })
    return {
      balance: 0,
      totalPurchased: 0,
      totalUsed: 0,
      lastPurchaseAt: null,
      depletionBehavior: 'fallback_to_overage',
    }
  }
}
