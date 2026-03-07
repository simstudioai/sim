/**
 * Daily Refresh Credits
 *
 * Each billing period is divided into 1-day windows starting from `periodStart`.
 * Users receive `planDollars * DAILY_REFRESH_RATE` in "included" usage per day.
 * Usage within that allowance does not count toward the plan limit (use-it-or-lose-it).
 *
 * The total refresh consumed in a period is:
 *   SUM( MIN(day_usage, daily_refresh_amount) ) for each day
 *
 * This is subtracted from `currentPeriodCost` to derive "effective billable usage".
 */

import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, gte, inArray, lt, sum } from 'drizzle-orm'
import { DAILY_REFRESH_RATE } from '@/lib/billing/constants'

const logger = createLogger('DailyRefresh')

const MS_PER_DAY = 86_400_000

interface DayWindow {
  start: Date
  end: Date
}

/**
 * Build 1-day windows from `periodStart` up to now (or `periodEnd`).
 */
function getDayWindows(periodStart: Date, periodEnd?: Date | null): DayWindow[] {
  const windows: DayWindow[] = []
  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  let windowStart = new Date(periodStart)
  while (windowStart < cap) {
    const windowEnd = new Date(windowStart.getTime() + MS_PER_DAY)
    windows.push({
      start: new Date(windowStart),
      end: windowEnd > cap ? cap : windowEnd,
    })
    windowStart = windowEnd
  }
  return windows
}

/**
 * Query the total usage cost for a set of users within a time range.
 * Uses the (userId, createdAt) index on usage_log.
 */
async function getUsageInWindow(
  userIds: string[],
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  if (userIds.length === 0) return 0

  const result = await db
    .select({ total: sum(usageLog.cost) })
    .from(usageLog)
    .where(
      and(
        inArray(usageLog.userId, userIds),
        gte(usageLog.createdAt, windowStart),
        lt(usageLog.createdAt, windowEnd)
      )
    )

  return Number.parseFloat(result[0]?.total ?? '0')
}

/**
 * Compute the total daily refresh credits consumed in the current billing period.
 *
 * For each day from `periodStart`:
 *   consumed_today = MIN(actual_usage_today, daily_refresh_dollars)
 *
 * @returns Total dollars of refresh consumed across all days (to subtract from usage)
 */
export async function computeDailyRefreshConsumed(params: {
  userIds: string[]
  periodStart: Date
  periodEnd?: Date | null
  planDollars: number
}): Promise<number> {
  const { userIds, periodStart, periodEnd, planDollars } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE
  const windows = getDayWindows(periodStart, periodEnd)

  if (windows.length === 0) return 0

  let totalConsumed = 0

  for (const window of windows) {
    const dayUsage = await getUsageInWindow(userIds, window.start, window.end)
    const consumed = Math.min(dayUsage, dailyRefreshDollars)
    totalConsumed += consumed
  }

  logger.debug('Daily refresh computed', {
    userCount: userIds.length,
    periodStart: periodStart.toISOString(),
    days: windows.length,
    dailyRefreshDollars,
    totalConsumed,
  })

  return totalConsumed
}

/**
 * Get the daily refresh allowance in dollars for a plan.
 */
export function getDailyRefreshDollars(planDollars: number): number {
  return planDollars * DAILY_REFRESH_RATE
}
