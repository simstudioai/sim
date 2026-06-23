/**
 * Billing helpers for table feature limits.
 *
 * Uses workspace billing account to determine plan-based limits.
 */

import { createLogger } from '@sim/logger'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import { getTablePlanLimits, type PlanName, type TablePlanLimits } from '@/lib/table/constants'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

const logger = createLogger('TableBilling')

/** Notify at 80% only — a row insert can only push the count up. */
const TABLE_ROW_NOTIFY_PERCENT = 80

/**
 * Best-effort table row-limit email after an accepted insert. Resolves the
 * workspace's billed account, then delegates scope resolution + dedup + send to
 * {@link maybeNotifyLimit}. Never throws.
 */
async function maybeNotifyTableRowLimit(
  workspaceId: string,
  currentRowCount: number,
  projectedRowCount: number,
  limit: number
): Promise<void> {
  try {
    const billedUserId = await getWorkspaceBilledAccountUserId(workspaceId)
    if (!billedUserId) return

    await maybeNotifyLimit({
      category: 'tables',
      billedUserId,
      workspaceId,
      currentUsage: projectedRowCount,
      limit,
      usageLabel: `${projectedRowCount.toLocaleString('en-US')} rows`,
      limitLabel: `${limit.toLocaleString('en-US')} rows`,
      priorUsage: currentRowCount,
    })
  } catch (error) {
    logger.error('Error evaluating table row-limit notification:', error)
  }
}

/**
 * Fire-and-forget the table row-limit threshold email for an accepted insert,
 * gated so only near-limit writes pay the cost. Shared by every insert path
 * ({@link assertRowCapacity} and the transactional upsert/import branches that
 * check capacity with {@link wouldExceedRowLimit} instead). Pass the pre-insert
 * `currentRowCount` so a delete-then-insert jump re-arms correctly.
 */
export function notifyTableRowUsage(params: {
  workspaceId: string
  currentRowCount: number
  addedRows: number
  limit: number
}): void {
  if (params.limit <= 0) return
  const projected = params.currentRowCount + params.addedRows
  if ((projected / params.limit) * 100 >= TABLE_ROW_NOTIFY_PERCENT) {
    void maybeNotifyTableRowLimit(
      params.workspaceId,
      params.currentRowCount,
      projected,
      params.limit
    )
  }
}

/**
 * Plan lookups hit billing + subscription tables (2-3 queries). Row-limit checks
 * run on every insert, so a short TTL keeps the hot path off the DB. Plan changes
 * are rare and enforcement is best-effort, so brief staleness is acceptable.
 */
const LIMITS_CACHE_TTL_MS = 30_000
/** Hard ceiling on cached workspaces; a sweep drops expired entries before this is exceeded so the Map can't grow unbounded. */
const LIMITS_CACHE_MAX_ENTRIES = 5_000
const limitsCache = new Map<string, { limits: TablePlanLimits; expiresAt: number }>()

/**
 * Gets the table limits for a workspace based on its billing plan.
 *
 * Uses the workspace's billed account user to determine the subscription plan,
 * then returns the corresponding table limits. Resolved limits are cached for
 * {@link LIMITS_CACHE_TTL_MS}; the free-tier error fallback is never cached.
 *
 * @param workspaceId - The workspace ID to get limits for
 * @returns Table limits based on the workspace's billing plan
 */
export async function getWorkspaceTableLimits(workspaceId: string): Promise<TablePlanLimits> {
  const cached = limitsCache.get(workspaceId)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.limits
    limitsCache.delete(workspaceId)
  }

  const planLimits = getTablePlanLimits()

  try {
    const billedAccountUserId = await getWorkspaceBilledAccountUserId(workspaceId)

    if (!billedAccountUserId) {
      logger.warn('No billed account found for workspace, using free tier limits', { workspaceId })
      cacheLimits(workspaceId, planLimits.free)
      return planLimits.free
    }

    const subscription = await getHighestPrioritySubscription(billedAccountUserId)
    const planName = getPlanTypeForLimits(subscription?.plan) as PlanName

    const limits = planLimits[planName] ?? planLimits.free

    logger.info('Retrieved workspace table limits', {
      workspaceId,
      billedAccountUserId,
      planName,
      limits,
    })

    cacheLimits(workspaceId, limits)
    return limits
  } catch (error) {
    logger.error('Error getting workspace table limits, falling back to free tier', {
      workspaceId,
      error,
    })
    return planLimits.free
  }
}

function cacheLimits(workspaceId: string, limits: TablePlanLimits): void {
  // Keep the Map bounded for a new key: sweep expired entries, then (if a burst of
  // all-fresh entries still sits at the cap) evict oldest-inserted ones. Map iteration
  // is insertion order, so the first key is the oldest. Net: size never exceeds the cap.
  if (limitsCache.size >= LIMITS_CACHE_MAX_ENTRIES && !limitsCache.has(workspaceId)) {
    const now = Date.now()
    for (const [key, entry] of limitsCache) {
      if (entry.expiresAt <= now) limitsCache.delete(key)
    }
    while (limitsCache.size >= LIMITS_CACHE_MAX_ENTRIES) {
      const oldest = limitsCache.keys().next().value
      if (oldest === undefined) break
      limitsCache.delete(oldest)
    }
  }
  limitsCache.set(workspaceId, { limits, expiresAt: Date.now() + LIMITS_CACHE_TTL_MS })
}

/**
 * Thrown by {@link assertRowCapacity} when a write would exceed the workspace's
 * current plan row limit. The message includes the lowercase `row limit` token so
 * `rowWriteErrorResponse` maps it to a 400 toast carrying the real reason.
 */
export class TableRowLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `This table has reached its row limit (${limit.toLocaleString('en-US')} rows) on your current plan.`
    )
    this.name = 'TableRowLimitError'
  }
}

/**
 * Whether adding `addedRows` to `currentRowCount` would cross `limit`. A negative
 * limit means unlimited. Single source of truth for the comparison so callers that
 * fetch the limit themselves (e.g. inside a transaction, or to build a custom
 * message) stay consistent with {@link assertRowCapacity}.
 */
export function wouldExceedRowLimit(
  limit: number,
  currentRowCount: number,
  addedRows: number
): boolean {
  return limit >= 0 && currentRowCount + addedRows > limit
}

/**
 * Best-effort capacity check against the workspace's CURRENT plan limit.
 *
 * Not transactional: reads the (trigger-maintained, possibly slightly stale) row
 * count and the cached plan limit outside any lock, so concurrent writers may
 * overshoot by a small amount. It rejects once the count is at/over the limit, so
 * a table can't run away past its plan.
 *
 * Resolve the limit OUTSIDE any open transaction — `getMaxRowsPerTable` may hit the
 * billing/subscription tables on the global pool, and doing that while holding a tx
 * connection (and locks) risks pool starvation. Callers already inside a tx should
 * fetch the limit up front and use {@link wouldExceedRowLimit} instead.
 *
 * Pure check (no side effects): returns the resolved limit so callers can fire
 * {@link notifyTableRowUsage} AFTER their insert commits — a pre-commit notify
 * would email (and burn the dedup claim) for a write that later rolls back.
 *
 * @returns the resolved plan row limit (-1 for unlimited)
 * @throws {TableRowLimitError} if `currentRowCount + addedRows` exceeds the limit
 */
export async function assertRowCapacity(params: {
  workspaceId: string
  currentRowCount: number
  addedRows: number
}): Promise<number> {
  const limit = await getMaxRowsPerTable(params.workspaceId)
  if (wouldExceedRowLimit(limit, params.currentRowCount, params.addedRows)) {
    throw new TableRowLimitError(limit)
  }
  return limit
}

/**
 * Checks if a workspace can create more tables based on its plan limits.
 *
 * @param workspaceId - The workspace ID to check
 * @param currentTableCount - The current number of tables in the workspace
 * @returns Object with canCreate boolean and limit info
 */
async function canCreateTable(
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
