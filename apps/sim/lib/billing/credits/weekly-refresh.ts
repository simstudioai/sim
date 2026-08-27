/**
 * Weekly Refresh Credits
 *
 * Each billing period is divided into 7-day windows starting from `periodStart`.
 * Paid plans receive a fixed `weeklyRefreshDollars * seats` allowance of
 * "included" usage per window. Usage within that allowance does not count toward
 * the plan limit (use-it-or-lose-it). A partial final window receives the full
 * allowance — the MIN cap never prorates.
 *
 * The total refresh consumed in a period is:
 *   SUM( MIN(week_usage, weekly_allowance) ) for each week
 *
 * This is subtracted from ledger period usage to derive "effective billable usage".
 *
 * Refresh reads are scoped by the ledger's write-time entity and period
 * stamps — never by an actor list. Every row attributed to the billing entity
 * participates in that entity's refresh, exactly like it participates in the
 * entity's ledger total: rows from a member who departed the organization
 * mid-period stay stamped to the organization, and a member's pre-join rows
 * are user-stamped, so they can never appear under an organization entity.
 */

import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, lt, or, sql, sum } from 'drizzle-orm'
import type { BillingEntity, UsageQueryPeriod } from '@/lib/billing/core/usage-log'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('WeeklyRefresh')

const MS_PER_DAY = 86_400_000
const MAX_BILLING_PERIOD_DAYS = 370

interface BillingPeriodUsageWithWeeklyRefreshParams {
  billingEntity: BillingEntity
  billingPeriod: UsageQueryPeriod
  refreshPeriodStart: Date
  refreshPeriodEnd?: Date | null
  weeklyRefreshDollars: number
  seats?: number
}

/**
 * Reads the exact ledger total and the weekly-refresh buckets from one snapshot.
 *
 * The two aggregates intentionally keep different predicates. Ledger totals
 * use both captured period bounds (or a reporting-time window), while refresh
 * membership is the captured period-start stamp alone — created-at only
 * buckets rows into weeks, clamped into the period (see
 * `computeWeeklyRefreshConsumed` for why).
 */
export async function computeBillingPeriodUsageWithWeeklyRefresh(
  params: BillingPeriodUsageWithWeeklyRefreshParams,
  executor: DbClient = db
): Promise<{ ledgerUsage: number; refreshConsumed: number }> {
  const {
    billingEntity,
    billingPeriod,
    refreshPeriodStart,
    refreshPeriodEnd,
    weeklyRefreshDollars,
    seats = 1,
  } = params
  const now = new Date()
  const cap = refreshPeriodEnd && refreshPeriodEnd < now ? refreshPeriodEnd : now
  const weeklyAllowanceDollars = weeklyRefreshDollars * seats
  const refreshWindowActive = cap > refreshPeriodStart
  const refreshFilter = refreshWindowActive
    ? eq(usageLog.billingPeriodStart, refreshPeriodStart)
    : sql<boolean>`false`
  const ledgerPeriodFilter =
    billingPeriod.source === 'reporting'
      ? and(gte(usageLog.createdAt, billingPeriod.start), lt(usageLog.createdAt, billingPeriod.end))
      : and(
          eq(usageLog.billingPeriodStart, billingPeriod.start),
          eq(usageLog.billingPeriodEnd, billingPeriod.end)
        )

  const sameCapturedPeriodStart =
    billingPeriod.source !== 'reporting' &&
    billingPeriod.start.getTime() === refreshPeriodStart.getTime()
  const scanFilter = !refreshWindowActive
    ? ledgerPeriodFilter
    : sameCapturedPeriodStart
      ? eq(usageLog.billingPeriodStart, billingPeriod.start)
      : or(ledgerPeriodFilter, refreshFilter)

  const startEpoch = Math.floor(refreshPeriodStart.getTime() / 1000)
  const capEpoch = Math.floor(cap.getTime() / 1000)
  const rows = await executor
    .select({
      weekIndex:
        sql<number>`FLOOR((LEAST(GREATEST(EXTRACT(EPOCH FROM ${usageLog.createdAt}), ${startEpoch}), ${capEpoch - 1}) - ${startEpoch}) / 604800)`.as(
          'week_index'
        ),
      ledgerTotal:
        sql<string>`SUM(SUM(${usageLog.cost}) FILTER (WHERE ${ledgerPeriodFilter})) OVER ()`.as(
          'ledger_total'
        ),
      refreshWeekTotal: sql<string>`SUM(${usageLog.cost}) FILTER (WHERE ${refreshFilter})`.as(
        'refresh_week_total'
      ),
    })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        scanFilter
      )
    )
    .groupBy(sql`week_index`)

  let refreshConsumed = 0
  for (const row of rows) {
    const weekUsage = Number.parseFloat(row.refreshWeekTotal ?? '0')
    refreshConsumed += Math.min(weekUsage, weeklyAllowanceDollars)
  }

  return {
    ledgerUsage: Number.parseFloat(rows[0]?.ledgerTotal ?? '0'),
    refreshConsumed,
  }
}

/**
 * Compute the total weekly refresh credits a billing entity consumed in a
 * period, using a single aggregating SQL query grouped by week offset.
 *
 * For each 7-day window from `periodStart`:
 *   consumed_this_week = MIN(actual_usage_this_week, weekly_allowance_dollars)
 *
 * Rows are scoped purely by the entity and period stamps — see the module
 * header for why no actor list participates.
 *
 * @returns Total dollars of refresh consumed across all weeks (to subtract from usage)
 */
export async function computeWeeklyRefreshConsumed(
  params: {
    billingEntity: BillingEntity
    periodStart: Date
    periodEnd?: Date | null
    weeklyRefreshDollars: number
    seats?: number
  },
  executor: DbClient = db
): Promise<number> {
  const { billingEntity, periodStart, periodEnd, weeklyRefreshDollars, seats = 1 } = params

  if (weeklyRefreshDollars <= 0) return 0

  const weeklyAllowanceDollars = weeklyRefreshDollars * seats

  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  if (cap <= periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount > MAX_BILLING_PERIOD_DAYS) {
    throw new Error('Billing period exceeds the supported annual bound')
  }

  // Membership mirrors the ledger sums exactly: the entity and period stamps
  // alone. Created-at only assigns the week bucket, clamped into the period —
  // a straggler row written after the rollover (billing attribution is frozen
  // at run start) is billed by the stamp-based close, so it must consume
  // refresh in the period's final week rather than fall out of the deduction.
  const startEpoch = Math.floor(periodStart.getTime() / 1000)
  const capEpoch = Math.floor(cap.getTime() / 1000)
  const rows = await executor
    .select({
      weekIndex:
        sql<number>`FLOOR((LEAST(GREATEST(EXTRACT(EPOCH FROM ${usageLog.createdAt}), ${startEpoch}), ${capEpoch - 1}) - ${startEpoch}) / 604800)`.as(
          'week_index'
        ),
      weekTotal: sum(usageLog.cost).as('week_total'),
    })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        eq(usageLog.billingPeriodStart, periodStart)
      )
    )
    .groupBy(sql`week_index`)

  let totalConsumed = 0
  for (const row of rows) {
    const weekUsage = Number.parseFloat(row.weekTotal ?? '0')
    totalConsumed += Math.min(weekUsage, weeklyAllowanceDollars)
  }

  logger.debug('Weekly refresh computed', {
    billingEntityType: billingEntity.type,
    periodStart: periodStart.toISOString(),
    weeks: Math.ceil(dayCount / 7),
    weeklyAllowanceDollars,
    totalConsumed,
  })

  return totalConsumed
}
