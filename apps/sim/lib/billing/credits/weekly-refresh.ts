/**
 * Weekly Refresh Credits
 *
 * Each billing period is divided into 7-day windows starting from `periodStart`.
 * Users receive `planDollars * WEEKLY_REFRESH_RATE` in "included" usage per week.
 * Usage within that allowance does not count toward the plan limit (use-it-or-lose-it).
 *
 * The total refresh consumed in a period is:
 *   SUM( MIN(week_usage, weekly_refresh_amount) ) for each week
 *
 * This is subtracted from `currentPeriodCost` to derive "effective billable usage".
 */

import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, gte, inArray, lt, sum } from 'drizzle-orm'
import { WEEKLY_REFRESH_RATE } from '@/lib/billing/constants'

const logger = createLogger('WeeklyRefresh')

const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7

interface WeekWindow {
  start: Date
  end: Date
}

/**
 * Build the 7-day windows from `periodStart` up to now (or `periodEnd`).
 */
function getWeekWindows(periodStart: Date, periodEnd?: Date | null): WeekWindow[] {
  const windows: WeekWindow[] = []
  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  let windowStart = new Date(periodStart)
  while (windowStart < cap) {
    const windowEnd = new Date(windowStart.getTime() + DAYS_PER_WEEK * MS_PER_DAY)
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
 * Compute the total weekly refresh credits consumed in the current billing period.
 *
 * For each 7-day window from `periodStart`:
 *   consumed_this_week = MIN(actual_usage_this_week, weekly_refresh_dollars)
 *
 * @returns Total dollars of refresh consumed across all weeks (to subtract from usage)
 */
export async function computeWeeklyRefreshConsumed(params: {
  userIds: string[]
  periodStart: Date
  periodEnd?: Date | null
  planDollars: number
}): Promise<number> {
  const { userIds, periodStart, periodEnd, planDollars } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const weeklyRefreshDollars = planDollars * WEEKLY_REFRESH_RATE
  const windows = getWeekWindows(periodStart, periodEnd)

  if (windows.length === 0) return 0

  let totalConsumed = 0

  for (const window of windows) {
    const weekUsage = await getUsageInWindow(userIds, window.start, window.end)
    const consumed = Math.min(weekUsage, weeklyRefreshDollars)
    totalConsumed += consumed
  }

  logger.debug('Weekly refresh computed', {
    userCount: userIds.length,
    periodStart: periodStart.toISOString(),
    weeks: windows.length,
    weeklyRefreshDollars,
    totalConsumed,
  })

  return totalConsumed
}

/**
 * Get the weekly refresh allowance in dollars for a plan.
 */
export function getWeeklyRefreshDollars(planDollars: number): number {
  return planDollars * WEEKLY_REFRESH_RATE
}
