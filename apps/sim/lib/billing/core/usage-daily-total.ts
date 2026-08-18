import { db } from '@sim/db'
import { usageLog, usageLogDailyTotal } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, inArray, type SQL, sql } from 'drizzle-orm'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import type { DbClient, DbOrTx } from '@/lib/db/types'

const logger = createLogger('UsageDailyTotal')

export const MS_PER_DAY = 86_400_000

export interface BillingPeriodRange {
  start: Date
  end: Date
}

/**
 * The day bucket an event falls in: whole 24h windows from the period start.
 *
 * {@link dayIndexSql} is the same expression evaluated in the database. Both
 * exist because buckets are written from application code but recomputed — and
 * read back by the ledger fallback — in SQL, and the two must agree exactly.
 * They derive from this one definition rather than from hand-copied
 * `floor(… / 86400)` expressions that can silently drift apart.
 */
export function dayIndexFor(periodStart: Date, occurredAt: Date): number {
  return Math.floor((occurredAt.getTime() - periodStart.getTime()) / MS_PER_DAY)
}

/**
 * {@link dayIndexFor} as a SQL expression.
 *
 * Takes the period start as a column or timestamp rather than as pre-truncated
 * whole seconds, so the epoch subtraction keeps full precision and buckets
 * events identically to `dayIndexFor` even when a period start carries a
 * sub-second component.
 */
export function dayIndexSql(createdAt: unknown, periodStart: unknown): SQL {
  return sql`floor((extract(epoch from ${createdAt}) - extract(epoch from ${periodStart})) / 86400)::int`
}

/**
 * Applies a signed delta to one `(user, day)` bucket.
 *
 * Must run inside the same transaction as the `usage_log` mutation it accounts
 * for. The upsert is a single statement, so concurrent writers serialize on the
 * row rather than on a read-modify-write in application code, and a rolled-back
 * ledger write rolls the bucket back with it.
 *
 * A zero delta is skipped so a no-op flush does not manufacture a row version.
 */
export async function applyUsageDailyTotalDelta(
  executor: DbOrTx,
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  /** The `usage_log.user_id` the ledger rows were written under. */
  userId: string,
  occurredAt: Date,
  delta: number
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) {
    return
  }

  await executor
    .insert(usageLogDailyTotal)
    .values({
      billingEntityType: billingEntity.type,
      billingEntityId: billingEntity.id,
      billingPeriodStart: billingPeriod.start,
      billingPeriodEnd: billingPeriod.end,
      userId,
      dayIndex: dayIndexFor(billingPeriod.start, occurredAt),
      totalCost: delta.toString(),
    })
    .onConflictDoUpdate({
      target: [
        usageLogDailyTotal.billingEntityType,
        usageLogDailyTotal.billingEntityId,
        usageLogDailyTotal.billingPeriodStart,
        usageLogDailyTotal.billingPeriodEnd,
        usageLogDailyTotal.userId,
        usageLogDailyTotal.dayIndex,
      ],
      set: {
        totalCost: sql`${usageLogDailyTotal.totalCost} + ${delta.toString()}::numeric`,
        updatedAt: sql`now()`,
      },
    })
}

/**
 * Whether reads may be served from the rollup at all.
 *
 * Owned here rather than at each call site so that turning reads off is one
 * switch, and so a new consumer cannot forget it: a disabled flag funnels into
 * the same `null` every read below already uses for "cannot answer — aggregate
 * the ledger instead".
 */
async function rollupReadsEnabled(): Promise<boolean> {
  return isFeatureEnabled('usage-daily-total-reads')
}

/**
 * Reads the whole-period total by summing every bucket in the period.
 *
 * Returns `null` when the rollup cannot answer: reads are disabled, or the
 * period has no buckets. "No buckets" is distinct from a total of zero — it
 * means this (entity, period) has not been written since the rollup began
 * being maintained, so the caller must aggregate the ledger rather than report
 * no usage. `SUM` over no rows is `NULL` while `total_cost` is `NOT NULL`, so
 * the sum itself carries that signal and needs no companion count.
 */
export async function readUsagePeriodTotal(
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  executor: DbClient = db
): Promise<number | null> {
  if (!(await rollupReadsEnabled())) {
    return null
  }

  const [row] = await executor
    .select({ totalCost: sql<string | null>`SUM(${usageLogDailyTotal.totalCost})` })
    .from(usageLogDailyTotal)
    .where(
      and(
        eq(usageLogDailyTotal.billingEntityType, billingEntity.type),
        eq(usageLogDailyTotal.billingEntityId, billingEntity.id),
        eq(usageLogDailyTotal.billingPeriodStart, billingPeriod.start),
        eq(usageLogDailyTotal.billingPeriodEnd, billingPeriod.end)
      )
    )

  if (!row || row.totalCost === null) {
    return null
  }
  return Number.parseFloat(row.totalCost)
}

/**
 * Reads per-day totals for a set of users, summed across those users.
 *
 * Returns `null` for the same reasons {@link readUsagePeriodTotal} does.
 *
 * Deliberately does NOT filter `billingPeriodEnd`, even though it is part of
 * the key: the ledger aggregate this stands in for scopes on
 * `(type, id, period_start)` only, so adding the end would make this read
 * narrower than the ledger and under-report if a period start ever carried two
 * different ends.
 */
export async function readUsageDailyTotals(
  billingEntity: BillingEntity,
  periodStart: Date,
  userIds: string[],
  executor: DbClient = db
): Promise<Map<number, number> | null> {
  if (!(await rollupReadsEnabled())) {
    return null
  }
  if (userIds.length === 0) {
    return new Map()
  }

  const rows = await executor
    .select({
      dayIndex: usageLogDailyTotal.dayIndex,
      totalCost: sql<string | null>`SUM(${usageLogDailyTotal.totalCost})`,
    })
    .from(usageLogDailyTotal)
    .where(
      and(
        eq(usageLogDailyTotal.billingEntityType, billingEntity.type),
        eq(usageLogDailyTotal.billingEntityId, billingEntity.id),
        eq(usageLogDailyTotal.billingPeriodStart, periodStart),
        inArray(usageLogDailyTotal.userId, userIds),
        // Mirrors the ledger query's `created_at >= period_start`. No upper
        // bound is needed: callers only take this path for a period still
        // capped at `now`, and no bucket can exist beyond that.
        gte(usageLogDailyTotal.dayIndex, 0)
      )
    )
    .groupBy(usageLogDailyTotal.dayIndex)

  if (rows.length === 0) {
    return null
  }
  return new Map(rows.map((row) => [row.dayIndex, Number.parseFloat(row.totalCost ?? '0')]))
}

/**
 * Recomputes buckets from the ledger, which stays the source of truth.
 *
 * The rollup is maintained transactionally and so should never drift, but it is
 * a derived billing number — this exists so drift is always recoverable rather
 * than permanent, and so buckets can be populated for periods that predate the
 * rollup without a migration-time backfill (which would have raced the deploy:
 * between the migration and the new image being live, the old code writes
 * ledger rows without maintaining the rollup, leaving a stale base that every
 * later increment would build on).
 *
 * `usage_log.user_id` cascades on user deletion, which removes ledger rows
 * without lowering the buckets they fed — the one non-transactional drift
 * source. Recomputing the surviving groups is not enough to repair it, because
 * a group whose ledger rows are *entirely* gone has nothing left to recompute
 * from and would keep its stale total forever, so orphaned buckets are deleted
 * outright rather than just refreshed.
 *
 * Writes absolute totals, so it is idempotent and safe to re-run.
 */
export async function reconcileUsageDailyTotals(options?: {
  /** Only reconcile periods that end at or after this instant. */
  periodEndsAfter?: Date
  executor?: DbClient
}): Promise<{ bucketsWritten: number; bucketsDeleted: number }> {
  const executor = options?.executor ?? db
  const periodEndsAfter = options?.periodEndsAfter
  const periodScope = periodEndsAfter
    ? sql`and ${usageLog.billingPeriodEnd} >= ${periodEndsAfter}`
    : sql``

  const ledgerBuckets = sql`
    select
      ${usageLog.billingEntityType} as billing_entity_type,
      ${usageLog.billingEntityId} as billing_entity_id,
      ${usageLog.billingPeriodStart} as billing_period_start,
      ${usageLog.billingPeriodEnd} as billing_period_end,
      ${usageLog.userId} as user_id,
      ${dayIndexSql(usageLog.createdAt, usageLog.billingPeriodStart)} as day_index,
      coalesce(sum(${usageLog.cost}), 0) as total_cost
    from ${usageLog}
    where ${usageLog.billingEntityType} is not null ${periodScope}
    group by 1, 2, 3, 4, 5, 6
  `

  const written = await executor.execute(sql`
    insert into ${usageLogDailyTotal} (
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index, total_cost, updated_at
    )
    select
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index, total_cost, now()
    from (${ledgerBuckets}) as ledger
    on conflict (
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index
    ) do update set
      total_cost = excluded.total_cost,
      updated_at = now()
    returning 1
  `)

  const deleted = await executor.execute(sql`
    delete from ${usageLogDailyTotal} as rollup
    where ${periodEndsAfter ? sql`rollup.billing_period_end >= ${periodEndsAfter} and` : sql``}
      not exists (
        select 1
        from (${ledgerBuckets}) as ledger
        where ledger.billing_entity_type = rollup.billing_entity_type
          and ledger.billing_entity_id = rollup.billing_entity_id
          and ledger.billing_period_start = rollup.billing_period_start
          and ledger.billing_period_end = rollup.billing_period_end
          and ledger.user_id = rollup.user_id
          and ledger.day_index = rollup.day_index
      )
    returning 1
  `)

  const bucketsWritten = Array.isArray(written) ? written.length : 0
  const bucketsDeleted = Array.isArray(deleted) ? deleted.length : 0
  logger.info('Reconciled usage daily totals', {
    bucketsWritten,
    bucketsDeleted,
    periodEndsAfter,
  })
  return { bucketsWritten, bucketsDeleted }
}
