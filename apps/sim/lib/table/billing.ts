/**
 * Billing helpers for table feature limits.
 *
 * Uses workspace billing account to determine plan-based limits.
 */

import { createLogger } from '@sim/logger'
import { getUserSubscriptionState } from '@/lib/billing/core/subscription'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { type PlanName, TABLE_PLAN_LIMITS, type TablePlanLimits } from './constants'

const logger = createLogger('TableBilling')

/**
 * Gets the table limits for a workspace based on its billing plan.
 *
 * Uses the workspace's billed account user to determine the subscription plan,
 * then returns the corresponding table limits.
 *
 * @param workspaceId - The workspace ID to get limits for
 * @returns Table limits based on the workspace's billing plan
 */
export async function getWorkspaceTableLimits(workspaceId: string): Promise<TablePlanLimits> {
  try {
    const billedAccountUserId = await getWorkspaceBilledAccountUserId(workspaceId)

    if (!billedAccountUserId) {
      logger.warn('No billed account found for workspace, using free tier limits', { workspaceId })
      return TABLE_PLAN_LIMITS.free
    }

    const subscriptionState = await getUserSubscriptionState(billedAccountUserId)
    const planName = subscriptionState.planName as PlanName

    const limits = TABLE_PLAN_LIMITS[planName] ?? TABLE_PLAN_LIMITS.free

    logger.info('Retrieved workspace table limits', {
      workspaceId,
      billedAccountUserId,
      planName,
      limits,
    })

    return limits
  } catch (error) {
    logger.error('Error getting workspace table limits, falling back to free tier', {
      workspaceId,
      error,
    })
    return TABLE_PLAN_LIMITS.free
  }
}

/**
 * Checks if a workspace can create more tables based on its plan limits.
 *
 * @param workspaceId - The workspace ID to check
 * @param currentTableCount - The current number of tables in the workspace
 * @returns Object with canCreate boolean and limit info
 */
export async function canCreateTable(
  workspaceId: string,
  currentTableCount: number
): Promise<{ canCreate: boolean; maxTables: number; currentCount: number }> {
  const limits = await getWorkspaceTableLimits(workspaceId)

  return {
    canCreate: currentTableCount < limits.maxTables,
    maxTables: limits.maxTables,
    currentCount: currentTableCount,
  }
}

/**
 * Gets the maximum rows allowed per table for a workspace based on its plan.
 *
 * @param workspaceId - The workspace ID
 * @returns Maximum rows per table (-1 for unlimited)
 */
export async function getMaxRowsPerTable(workspaceId: string): Promise<number> {
  const limits = await getWorkspaceTableLimits(workspaceId)
  return limits.maxRowsPerTable
}
